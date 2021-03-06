"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prettier_1 = __importDefault(require("../prettier"));
const { group, hardline, indent, makeString, join, line, softline } = prettier_1.default;
// For some lists of entities in the AST, the parser returns them as an unsorted
// object (presumably because Ruby hashes have implicit ordering). We do not
// have that in JavaScript, so here we sort each object by its position in the
// source string.
function getSortedKeys(object) {
    return Object.keys(object).sort((left, right) => object[left].type.location.start_pos -
        object[right].type.location.start_pos);
}
// In some cases, we want to just defer to whatever was in the source.
function getSource(node, opts) {
    const { location } = node;
    return opts.originalText.slice(location.start_pos, location.end_pos);
}
const printer = {
    // This is the generic node print function, used to convert any node in the
    // AST into its equivalent Doc representation.
    print(path, opts, print) {
        const node = path.getValue();
        let doc = null;
        if (node.declarations) {
            // Prints out the root of the tree, which includes zero or more
            // declarations.
            return [
                join([hardline, hardline], path.map(print, "declarations")),
                hardline
            ];
        }
        /* istanbul ignore else */
        if (node.declaration) {
            switch (node.declaration) {
                // Prints out a type alias, which is a declaration that looks like:
                // type foo = String
                case "alias": {
                    doc = group([
                        "type ",
                        node.name,
                        " =",
                        indent(group([line, path.call(printType, "type")]))
                    ]);
                    break;
                }
                // Prints out a class declarations, which looks like:
                // class Foo end
                case "class": {
                    const nodePath = path;
                    const parts = [
                        "class ",
                        printNameAndTypeParams(nodePath, node)
                    ];
                    if (node.super_class) {
                        const superPath = nodePath;
                        parts.push(" < ", superPath.call(printNameAndArgs, "super_class"));
                    }
                    parts.push(indent(printMembers(nodePath)), hardline, "end");
                    doc = group(parts);
                    break;
                }
                // Prints out a constant or a global declaration, which looks like:
                // Foo: String
                // $foo: String
                case "constant":
                case "global": {
                    doc = group([node.name, ": ", path.call(printType, "type")]);
                    break;
                }
                // Prints out an interface declaration, which looks like:
                // interface _Foo end
                case "interface": {
                    const nodePath = path;
                    doc = group([
                        "interface ",
                        printNameAndTypeParams(nodePath, node),
                        indent(printMembers(nodePath)),
                        hardline,
                        "end"
                    ]);
                    break;
                }
                // Prints out a module declaration, which looks like:
                // module Foo end
                case "module": {
                    const nodePath = path;
                    const parts = [
                        "module ",
                        printNameAndTypeParams(nodePath, node)
                    ];
                    if (node.self_types.length > 0) {
                        parts.push(" : ", join(", ", nodePath.map(printNameAndArgs, "self_types")));
                    }
                    parts.push(indent(printMembers(nodePath)), hardline, "end");
                    doc = group(parts);
                    break;
                }
                /* istanbul ignore next */
                default:
                    throw new Error(`unknown declaration: ${node.declaration}`);
            }
        }
        else if (node.member) {
            switch (node.member) {
                // Prints out an alias within a declaration, which looks like:
                // alias foo bar
                // alias self.foo self.bar
                case "alias": {
                    if (node.kind === "singleton") {
                        doc = ["alias self.", node.new_name, " self.", node.old_name];
                    }
                    else {
                        doc = ["alias ", node.new_name, " ", node.old_name];
                    }
                    break;
                }
                // Prints out an attr_* meta method, which looks like:
                // attr_accessor foo
                // attr_reader self.foo()
                // attr_writer self.foo(@bar): String
                case "attr_accessor":
                case "attr_reader":
                case "attr_writer": {
                    const parts = [node.member, " "];
                    if (node.kind === "singleton") {
                        parts.push("self.");
                    }
                    parts.push(node.name);
                    if (node.ivar_name === false) {
                        parts.push("()");
                    }
                    else if (node.ivar_name) {
                        parts.push("(", node.ivar_name, ")");
                    }
                    parts.push(": ", path.call(printType, "type"));
                    doc = group(parts);
                    break;
                }
                // Prints out a class or instance variable member, which looks like:
                // @foo: String
                // @@foo: String
                case "class_variable":
                case "instance_variable": {
                    doc = group([node.name, ": ", path.call(printType, "type")]);
                    break;
                }
                // Prints out a class instance variable member, which looks like:
                // self.@foo: String
                case "class_instance_variable": {
                    doc = ["self.", node.name, ": ", path.call(printType, "type")];
                    break;
                }
                // Prints out a mixin, which looks like:
                // include Foo
                // prepend Foo
                // extend Foo
                case "include":
                case "extend":
                case "prepend": {
                    const nodePath = path;
                    doc = group([node.member, " ", printNameAndArgs(nodePath)]);
                    break;
                }
                case "public":
                case "private": {
                    doc = node.member;
                    break;
                }
                case "method_definition": {
                    const nodePath = path;
                    doc = printMethodDefinition(nodePath, node);
                    break;
                }
                /* istanbul ignore next */
                default:
                    throw new Error(`unknown member: ${node.member}`);
            }
        }
        else {
            const ast = JSON.stringify(node, null, 2);
            throw new Error(`Unsupported node encountered:\n${ast}`);
        }
        // An annotation can be attached to most kinds of nodes, and should be
        // printed using %a{}. Certain nodes can't have annotations at all.
        if (node.annotations && node.annotations.length > 0) {
            const annotationsPath = path;
            doc = [
                join(hardline, annotationsPath.map((annotationPath) => {
                    const annotationNode = annotationPath.getValue();
                    // If there are already braces inside the annotation, then we're
                    // just going to print out the original string to avoid having to
                    // escape anything.
                    if (/[{}]/.test(annotationNode.string)) {
                        return getSource(annotationNode, opts);
                    }
                    return ["%a{", annotationNode.string, "}"];
                }, "annotations")),
                hardline,
                doc
            ];
        }
        // Comments come in as one whole string, so here we split it up into
        // multiple lines and then prefix it with the pound sign.
        if (node.comment) {
            doc = [
                join(hardline, node.comment.string
                    .slice(0, -1)
                    .split("\n")
                    .map((segment) => `# ${segment}`)),
                hardline,
                doc
            ];
        }
        return doc;
        // Prints out a string in the source, which looks like:
        // 'foo'
        function printString(node) {
            // We're going to go straight to the source here, as if we don't then
            // we're going to end up with the result of String#inspect, which does
            // weird things to escape sequences.
            const value = getSource(node, opts);
            // Get the quote that was used in the source and the quote that we want to
            // be using.
            const originalQuote = value[0];
            const preferredQuote = opts.rubySingleQuote ? "'" : '"';
            // Determine if we're allowed to change the quote based on whether or not
            // there is an escape sequence in the source string.
            const quote = node.literal.includes("\\")
                ? originalQuote
                : preferredQuote;
            return makeString(value.slice(1, -1), quote, false);
        }
        // Certain nodes are names with optional arguments attached, as in Array[A].
        // We handle all of that printing centralized here.
        function printNameAndArgs(path) {
            const node = path.getValue();
            if (node.args.length === 0) {
                return node.name;
            }
            return group([
                node.name,
                "[",
                join(", ", path.map(printType, "args")),
                "]"
            ]);
        }
        // This is the big function that prints out any individual type, which can
        // look like all kinds of things, listed in the case statement below.
        function printType(path, options) {
            const node = path.getValue();
            const forceParens = typeof options === "object" && options.forceParens;
            switch (node.class) {
                case "literal":
                    if (node.literal[0] === '"') {
                        return printString(node);
                    }
                    return node.literal;
                case "optional": {
                    const nodePath = path;
                    return [
                        nodePath.call((typePath) => printType(typePath, { forceParens: true }), "type"),
                        "?"
                    ];
                }
                case "tuple": {
                    // If we don't have any sub types, we explicitly need the space in
                    // between the brackets to not confuse the parser.
                    if (node.types.length === 0) {
                        return "[ ]";
                    }
                    const nodePath = path;
                    return group([
                        "[",
                        join(", ", nodePath.map(printType, "types")),
                        "]"
                    ]);
                }
                case "union": {
                    const nodePath = path;
                    const doc = group(join([line, "| "], nodePath.map(printType, "types")));
                    if (forceParens) {
                        return ["(", doc, ")"];
                    }
                    return doc;
                }
                case "intersection": {
                    const nodePath = path;
                    const doc = group(join([line, "& "], nodePath.map((typePath) => printType(typePath, { forceParens: true }), "types")));
                    if (forceParens) {
                        return ["(", doc, ")"];
                    }
                    return doc;
                }
                case "class_singleton":
                    return ["singleton(", node.name, ")"];
                case "proc":
                    return [
                        "^",
                        printMethodSignature(path)
                    ];
                case "record": {
                    const nodePath = path;
                    const parts = [];
                    getSortedKeys(node.fields).forEach((field) => {
                        const fieldParts = [];
                        if (node.fields[field].joiner === "rocket") {
                            fieldParts.push(`${field} => `);
                        }
                        else {
                            fieldParts.push(`${field}: `);
                        }
                        fieldParts.push(nodePath.call(printType, "fields", field, "type"));
                        parts.push(fieldParts);
                    });
                    return group([
                        "{",
                        indent([line, join([",", line], parts)]),
                        line,
                        "}"
                    ]);
                }
                case "class_instance":
                case "interface": {
                    const nodePath = path;
                    return printNameAndArgs(nodePath);
                }
                case "alias":
                case "variable":
                    return node.name;
                case "bool":
                case "bot":
                case "class":
                case "instance":
                case "nil":
                case "self":
                case "top":
                case "untyped":
                case "void":
                    return node.class;
                /* istanbul ignore next */
                default:
                    throw new Error(`unknown type: ${node.class}`);
            }
        }
        // Prints out the members of a class, module, or interface.
        function printMembers(path) {
            let lastLine = null;
            const docs = [];
            path.each((memberPath) => {
                const memberNode = memberPath.getValue();
                if (lastLine !== null &&
                    memberNode.location.start.line - lastLine >= 2) {
                    docs.push([hardline, hardline]);
                }
                else {
                    docs.push(hardline);
                }
                docs.push(print(memberPath));
                lastLine = memberNode.location.end.line;
            }, "members");
            return docs;
        }
        // Prints out the name of a class, interface, or module declaration.
        // Additionally loops through each type parameter if there are any and print
        // them out joined by commas. Checks for validation and variance.
        function printNameAndTypeParams(path, node) {
            if (node.type_params.params.length === 0) {
                return node.name;
            }
            const docs = path.map((paramPath) => {
                const node = paramPath.getValue();
                const parts = [];
                if (node.skip_validation) {
                    parts.push("unchecked");
                }
                if (node.variance === "covariant") {
                    parts.push("out");
                }
                else if (node.variance === "contravariant") {
                    parts.push("in");
                }
                return join(" ", [...parts, node.name]);
            }, "type_params", "params");
            return [node.name, "[", join(", ", docs), "]"];
        }
        // Returns an array of printed parameters so that the calling function can
        // join them together in whatever way.
        function printMethodParams(path) {
            const node = path.getValue();
            let parts = [];
            // required positionals, as in (A)
            parts = parts.concat(path.map(printMethodParam, "required_positionals"));
            // optional positionals, as in (?A)
            parts = parts.concat(path.map((paramPath) => ["?", printMethodParam(paramPath)], "optional_positionals"));
            // rest positional, as in (*A)
            if (node.rest_positionals) {
                const restPositionalsPath = path;
                parts.push([
                    "*",
                    restPositionalsPath.call(printMethodParam, "rest_positionals")
                ]);
            }
            // trailing positionals are required positionals after a rest
            parts = parts.concat(path.map(printMethodParam, "trailing_positionals"));
            // required keywords, as in (a: A)
            getSortedKeys(node.required_keywords).forEach((name) => {
                parts.push([
                    name,
                    ": ",
                    path.call(printMethodParam, "required_keywords", name)
                ]);
            });
            // optional keywords, as in (?a: A)
            getSortedKeys(node.optional_keywords).forEach((name) => {
                parts.push([
                    "?",
                    name,
                    ": ",
                    path.call(printMethodParam, "optional_keywords", name)
                ]);
            });
            // rest keyword, as in (**A)
            if (node.rest_keywords) {
                const restKeywordsPath = path;
                parts.push([
                    "**",
                    restKeywordsPath.call(printMethodParam, "rest_keywords")
                ]);
            }
            return parts;
            // Prints out a method parameter at a given path. Handles printing out the
            // name if there is one (and whether or not it's escaped).
            function printMethodParam(path) {
                const node = path.getValue();
                const parts = [path.call(printType, "type")];
                if (node.name) {
                    parts.push(" ");
                    if (node.escaped) {
                        parts.push("`", node.name, "`");
                    }
                    else {
                        parts.push(node.name);
                    }
                }
                return parts;
            }
        }
        // Prints out a specific method signature, which looks like:
        // (T t) -> void
        function printMethodSignature(path) {
            const node = path.getValue();
            const parts = [];
            // We won't have a type_params key if we're printing a block
            if (node.type_params && node.type_params.length > 0) {
                parts.push("[", join(", ", node.type_params), "] ");
            }
            const params = path.call(printMethodParams, "type");
            if (params.length > 0) {
                parts.push("(", indent([softline, join([",", line], params)]), softline, ") ");
            }
            if (node.block) {
                if (!node.block.required) {
                    parts.push("?");
                }
                parts.push("{", indent([line, path.call(printMethodSignature, "block")]), line, "} ");
            }
            parts.push("-> ", path.call((typePath) => printType(typePath, { forceParens: true }), "type", "return_type"));
            return group(parts);
        }
        // Prints out a method definition, which looks like:
        // def t: (T t) -> void
        function printMethodDefinition(path, node) {
            let typeDocs = path.map(printMethodSignature, "types");
            if (node.overload) {
                typeDocs.push("...");
            }
            if (typeDocs.length === 1) {
                typeDocs = [" ", typeDocs[0]];
            }
            else {
                typeDocs = indent(group([line, join([line, "| "], typeDocs)]));
            }
            const parts = ["def "];
            if (node.kind === "singleton") {
                parts.push("self.");
            }
            else if (node.kind === "singleton_instance") {
                parts.push("self?.");
            }
            const escaped = isMethodNameEscaped();
            parts.push(escaped ? `\`${node.name}\`` : node.name, ":", typeDocs);
            return group(parts);
            // Determine if a method name is escaped in the original source.
            function isMethodNameEscaped() {
                const pos = node.location.start_pos + 4;
                const name = opts.originalText.slice(pos, pos + 2).trimStart();
                return name[0] === "`" && name[1] !== ":";
            }
        }
    },
    // This is an escape-hatch to ignore nodes in the tree. If you have a comment
    // that includes this pattern, then the entire node will be ignored and just
    // the original source will be printed out.
    hasPrettierIgnore(path) {
        const node = path.getValue();
        return ((node.comment && node.comment.string.includes("prettier-ignore")) || false);
    },
    // This function handles adding the format pragma to a source string. This is
    // an optional workflow for incremental adoption.
    insertPragma(text) {
        return `# @format${text[0] === "#" ? "\n" : "\n\n"}${text}`;
    }
};
exports.default = printer;
