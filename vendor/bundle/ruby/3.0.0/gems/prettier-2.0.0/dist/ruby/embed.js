"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prettier_1 = __importDefault(require("../prettier"));
const utils_1 = require("../utils");
const { group, indent, dedent, lineSuffix, mapDoc, markAsRoot, stripTrailingHardline } = prettier_1.default;
const parsers = {
    css: "css",
    javascript: "babel",
    js: "babel",
    less: "less",
    markdown: "markdown",
    ruby: "ruby",
    scss: "scss"
};
// This function is in here because it handles embedded parser values. I don't
// have a test that exercises it because I'm not sure for which parser it is
// necessary, but since it's in prettier core I'm keeping it here.
/* istanbul ignore next */
function replaceNewlines(doc) {
    return mapDoc(doc, (currentDoc) => typeof currentDoc === "string" && currentDoc.includes("\n")
        ? currentDoc
            .split(/(\n)/g)
            .map((v, i) => (i % 2 === 0 ? v : utils_1.literallineWithoutBreakParent))
        : currentDoc);
}
// Returns a number that represents the minimum amount of leading whitespace
// that is present on every line in the given string. So for example if you have
// the following heredoc:
//
//     <<~HERE
//       my
//       content
//       here
//     HERE
//
// then the return value of this function would be 2. If you indented every line
// of the inner content 2 more spaces then this function would return 4.
function getCommonLeadingWhitespace(content) {
    const pattern = /^\s+/;
    return content
        .split("\n")
        .slice(0, -1)
        .filter((line) => line.trim().length > 0)
        .reduce((minimum, line) => {
        const matched = pattern.exec(line);
        const length = matched ? matched[0].length : 0;
        return minimum === null ? length : Math.min(minimum, length);
    }, content.length);
}
// Returns a new string with the common whitespace stripped out. Effectively it
// emulates what a squiggly heredoc does in Ruby.
function stripCommonLeadingWhitespace(content) {
    const lines = content.split("\n");
    const minimum = getCommonLeadingWhitespace(content);
    return lines.map((line) => line.slice(minimum)).join("\n");
}
const embed = (path, print, textToDoc) => {
    const node = path.getValue();
    // Currently we only support embedded formatting on heredoc nodes
    if (node.type !== "heredoc") {
        return null;
    }
    // First, ensure that we don't have any interpolation
    const { beging, body, ending } = node;
    const isSquiggly = beging.body[2] === "~";
    if (body.some((part) => part.type !== "@tstring_content")) {
        return null;
    }
    // Next, find the parser associated with this heredoc (if there is one). For
    // example, if you use <<~CSS, we'd hook it up to the css parser.
    const parser = parsers[beging.body.slice(3).toLowerCase()];
    if (!parser) {
        return null;
    }
    // Get the content as if it were a source string.
    let content = body.map((part) => part.body).join("");
    // If we're using a squiggly heredoc, then we're going to manually strip off
    // the leading whitespace of each line up to the minimum leading whitespace so
    // that the embedded parser can handle that for us.
    if (isSquiggly) {
        content = stripCommonLeadingWhitespace(content);
    }
    // Pass that content into the embedded parser. Get back the doc node.
    const formatted = [
        utils_1.literallineWithoutBreakParent,
        replaceNewlines(stripTrailingHardline(textToDoc(content, { parser })))
    ];
    // If we're using a squiggly heredoc, then we can properly handle indentation
    // ourselves.
    if (isSquiggly) {
        return [
            path.call(print, "beging"),
            lineSuffix(dedent([
                indent(markAsRoot(formatted)),
                { type: "line", hard: true },
                ending.trim()
            ]))
        ];
    }
    // Otherwise, we need to just assume it's formatted correctly and return the
    // content as it is.
    return markAsRoot([
        path.call(print, "beging"),
        lineSuffix(group([formatted, utils_1.literallineWithoutBreakParent, ending.trim()]))
    ]);
};
exports.default = embed;
