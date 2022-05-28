# frozen_string_literal: true

require 'test_helper'

class TaxesControllerTest < ActionDispatch::IntegrationTest
  setup { @tax = taxes(:one) }

  test 'should get index' do
    get taxes_url
    assert_response :success
  end

  test 'should get new' do
    get new_tax_url
    assert_response :success
  end

  test 'should create tax' do
    assert_difference('Tax.count') do
      post taxes_url,
           params: {
             tax: {
               comment: @tax.comment,
               enabled: @tax.enabled,
               prov_id: @tax.prov_id,
               tax_rate: @tax.tax_rate
             }
           }
    end

    assert_redirected_to tax_url(Tax.last)
  end

  test 'should show tax' do
    get tax_url(@tax)
    assert_response :success
  end

  test 'should get edit' do
    get edit_tax_url(@tax)
    assert_response :success
  end

  test 'should update tax' do
    patch tax_url(@tax),
          params: {
            tax: {
              comment: @tax.comment,
              enabled: @tax.enabled,
              prov_id: @tax.prov_id,
              tax_rate: @tax.tax_rate
            }
          }
    assert_redirected_to tax_url(@tax)
  end

  test 'should destroy tax' do
    assert_difference('Tax.count', -1) { delete tax_url(@tax) }

    assert_redirected_to taxes_url
  end
end
