package ru.lounge1708.evotorbridge;
import static org.junit.Assert.*;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;

public class CashMappingsTest {
 private JSONObject rule(String name,String uuid,String fingerprint)throws Exception{return new JSONObject().put("name",name).put("parts",new JSONArray().put(new JSONObject().put("uuid",uuid).put("units",1).put("fingerprint",fingerprint)));}
 private JSONObject settings()throws Exception{return new JSONObject().put("schema",1).put("revision",1)
  .put("products",new JSONObject().put(CashMappings.key("Сенча",false),rule("Сенча","tea","t1")))
  .put("addons",new JSONObject().put(CashMappings.key("лимон",true),rule("лимон","lemon","l1")));}
 private JSONObject catalog()throws Exception{return new JSONObject().put("items",new JSONObject().put("tea",new JSONObject().put("priceKopecks",50000).put("fingerprint","t1").put("supported",true)).put("lemon",new JSONObject().put("priceKopecks",5000).put("fingerprint","l1").put("supported",true)));}
 @Test public void teaAndModifierResolveFromEditableDataAndKeepQuantity()throws Exception{
  java.util.List<CashMappings.Part> parts=CashMappings.resolve("Сенча + Лимон",settings());assertEquals(2,parts.size());assertEquals(55000,CashMappings.total(parts,catalog()));
  assertEquals(110000,Math.multiplyExact(CashMappings.total(parts,catalog()),2));
 }
 @Test public void unknownModifiersAndFreeOptionsAreNotSilentlyDropped()throws Exception{
  assertThrows(IllegalStateException.class,()->CashMappings.resolve("Сенча + имбирь",settings()));
  assertThrows(IllegalStateException.class,()->CashMappings.resolve("Сенча — другой вариант",settings()));
 }
 @Test public void newProductAndNewModifierRequireOnlyDataChanges()throws Exception{
  JSONObject s=settings();s.getJSONObject("products").put(CashMappings.key("Новый чай",false),rule("Новый чай","tea","t1"));s.getJSONObject("addons").put(CashMappings.key("имбирь",true),rule("имбирь","lemon","l1"));
  assertEquals(55000,CashMappings.total(CashMappings.resolve("Новый чай + имбирь",s),catalog()));
 }
 @Test public void exactVariantOverridesCompositionAndStaleCardIsRejected()throws Exception{
  JSONObject s=settings();s.getJSONObject("products").put(CashMappings.key("Сенча + лимон",false),rule("Сенча + лимон","tea","t1"));assertEquals(1,CashMappings.resolve("Сенча + лимон",s).size());
  JSONObject c=catalog();c.getJSONObject("items").getJSONObject("tea").put("fingerprint","changed");
  assertThrows(IllegalStateException.class,()->CashMappings.total(CashMappings.resolve("Сенча",s),c));
 }
}
