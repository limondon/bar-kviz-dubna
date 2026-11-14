package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import java.io.File;
import java.util.Arrays;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Test;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

public class FiscalDocumentsTest {
    @Test public void fiscalAuthorityIsVisibleOnAndroidElevenAndOnlySpecificProvidersAreDeclared() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance(); factory.setNamespaceAware(true);
        Element manifest = factory.newDocumentBuilder().parse(new File(System.getProperty("cash.manifest"))).getDocumentElement();
        NodeList queries = manifest.getElementsByTagName("queries"); boolean declared = false;
        for (int i = 0; i < queries.getLength(); i++) {
            NodeList providers = ((Element) queries.item(i)).getElementsByTagName("provider");
            for (int j = 0; j < providers.getLength(); j++) declared |= Arrays.asList(((Element) providers.item(j))
                    .getAttributeNS("http://schemas.android.com/apk/res/android", "authorities").split(";")).contains(FiscalDocuments.AUTHORITY);
        }
        assertTrue("Fiscal document provider was missing in 0.8", declared);
        NodeList permissions = manifest.getElementsByTagName("uses-permission");
        for (int i = 0; i < permissions.getLength(); i++) assertNotEquals("android.permission.QUERY_ALL_PACKAGES",
                ((Element) permissions.item(i)).getAttributeNS("http://schemas.android.com/apk/res/android", "name"));
    }
    @Test public void nullIsNeverTreatedAsProofThatTheReceiptWasUnpaid() {
        assertEquals(0, FiscalDocuments.checkedCount(0)); assertEquals(2, FiscalDocuments.checkedCount(2));
        assertThrows(IllegalStateException.class, () -> FiscalDocuments.checkedCount(null));
        assertThrows(IllegalStateException.class, () -> FiscalDocuments.checkedCount(-1));
    }
}
