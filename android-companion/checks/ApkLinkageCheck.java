import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.TreeSet;
import java.util.zip.ZipFile;

/** Check actual APK DEX member owners after shrinking, not just the dependency graph. */
public final class ApkLinkageCheck {
    private static final String CONTEXT_COMPAT = "Landroidx/core/content/ContextCompat;";
    private static final String ACTIVITY_COMPAT = "Landroidx/core/app/ActivityCompat;";
    private static final String CAPTURE = "Lcom/journeyapps/barcodescanner/CaptureActivity;";
    private static final class Dex {
        final ByteBuffer bytes;
        final String[] types;
        Dex(byte[] data) {
            bytes = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
            if(data.length < 112 || data[0]!='d' || data[1]!='e' || data[2]!='x') throw new IllegalArgumentException("Invalid DEX");
            String[] strings = new String[bytes.getInt(56)];
            int stringOffset = bytes.getInt(60);
            for(int i=0;i<strings.length;i++) {
                int offset=bytes.getInt(stringOffset+i*4);
                while((data[offset++] & 128)!=0) { /* Skip ULEB128 UTF-16 length. */ }
                int start=offset;
                while(data[offset]!=0) offset++;
                strings[i]=new String(data,start,offset-start,StandardCharsets.UTF_8);
            }
            types=new String[bytes.getInt(64)];
            int typeOffset=bytes.getInt(68);
            for(int i=0;i<types.length;i++) types[i]=strings[bytes.getInt(typeOffset+i*4)];
        }
        void collect(Set<String> defined, Set<String> referenced) {
            int classes=bytes.getInt(96), classOffset=bytes.getInt(100);
            for(int i=0;i<classes;i++) defined.add(types[bytes.getInt(classOffset+i*32)]);
            // field_id and method_id both start with an unsigned-short class_idx and are 8 bytes.
            for(int header : new int[]{80,88}) {
                int count=bytes.getInt(header), offset=bytes.getInt(header+4);
                for(int i=0;i<count;i++) {
                    String owner=types[Short.toUnsignedInt(bytes.getShort(offset+i*8))];
                    if(owner.startsWith("Landroidx/")) referenced.add(owner);
                }
            }
        }
    }
    public static void main(String[] args) throws Exception {
        if(args.length<1) throw new IllegalArgumentException("Usage: ApkLinkageCheck.java APK [--expect-missing|--scanner-core-only]");
        Set<String> defined=new TreeSet<>(), referenced=new TreeSet<>();
        int dexCount=0;
        try(ZipFile apk=new ZipFile(args[0])) {
            var entries=apk.entries();
            while(entries.hasMoreElements()) {
                var entry=entries.nextElement();
                if(!entry.getName().matches("classes(?:[0-9]+)?\\.dex")) continue;
                try(var stream=apk.getInputStream(entry)) { new Dex(stream.readAllBytes()).collect(defined,referenced); }
                dexCount++;
            }
        }
        if(dexCount==0 || !defined.contains(CAPTURE)) throw new AssertionError("Scanner activity missing from APK");
        // Unshrunk debug APKs retain ZXing's unused optional Fragment / ScanContract adapters.
        // Their optional dependencies are not needed by our IntentIntegrator entry point.
        boolean coreOnly=args.length>1 && args[1].equals("--scanner-core-only");
        if(coreOnly) referenced.removeIf(type -> !type.startsWith("Landroidx/core/"));
        referenced.removeAll(defined);
        if(args.length>1 && args[1].equals("--expect-missing")) {
            if(!referenced.contains(CONTEXT_COMPAT) || !referenced.contains(ACTIVITY_COMPAT)) throw new AssertionError("Old APK did not reproduce the missing scanner dependencies: "+referenced);
            System.out.println("REGRESSION REPRODUCED: old APK references missing " + referenced);
            return;
        }
        if(!referenced.isEmpty()) throw new AssertionError("APK has unresolved AndroidX runtime member owners: " + referenced);
        System.out.println("PASSED: " + dexCount + " DEX files, " + defined.size() + " defined classes; scanner activity present; all " + (coreOnly ? "AndroidX Core" : "AndroidX") + " runtime member owners included");
    }
}
