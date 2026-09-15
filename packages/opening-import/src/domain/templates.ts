const CATALOG_HEADER = "record_type,key,name_ar,parent_key,product_code,description_ar,category_key,default_price_egp,publication,image_refs,size_guide_ar,product_key,size_key,color_key,price_override_egp";
const STOCK_HEADER = "batch_key,variant_key,quantity,unit_cost_egp,receipt_date,batch_order";
const CONFIG_HEADER = "record_type,key,name_ar,value,variant_key,fee_egp,active,discount_type,percentage,amount_egp,starts_on,ends_on,allow_combination,usage_limit,product_keys,category_keys,buy_quantity,reward_quantity,reward_percentage,bundle_total_egp,offer_key,required_quantity,buy_product_keys,buy_category_keys,reward_product_keys,reward_category_keys";

export const OPENING_IMPORT_TEMPLATES = {
  "catalog.csv": `${CATALOG_HEADER}\ncategory,shirts,قمصان,,,,,,,,,,,,\nsize,l,كبير,,,,,,,,,,,,\ncolor,black,أسود,,,,,,,,,,,,\nproduct,shirt-1,قميص كلاسيك,,BR-001,قطن,shirts,500.00,available,,,,,,\nvariant,shirt-1-l-black,,,,,,,,,,shirt-1,l,black,\n`,
  "opening-stock.csv": `${STOCK_HEADER}\nold-stock,shirt-1-l-black,2,200.00,2026-08-01,1\nnew-stock,shirt-1-l-black,3,240.00,2026-09-01,2\n`,
  "configuration.csv": `${CONFIG_HEADER}\ninventory_default_threshold,default,,3,,,,,,,,,,,,,,,,,,,,,,\n`,
} as const;

export type OpeningImportTemplateName = keyof typeof OPENING_IMPORT_TEMPLATES;
