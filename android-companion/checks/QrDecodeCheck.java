import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.io.File;

public class QrDecodeCheck {
    public static void main(String[] args) throws Exception {
        BufferedImage image = ImageIO.read(new File(args[0]));
        LuminanceSource source = new LuminanceSource(image.getWidth(), image.getHeight()) {
            public byte[] getRow(int y, byte[] row) { int width=getWidth(); if(row==null || row.length<width) row=new byte[width]; for(int x=0;x<width;x++) { int rgb=image.getRGB(x,y); row[x]=(byte)((((rgb>>16)&255)*306+((rgb>>8)&255)*601+(rgb&255)*117)>>10); } return row; }
            public byte[] getMatrix() { byte[] result=new byte[getWidth()*getHeight()];for(int y=0;y<getHeight();y++)System.arraycopy(getRow(y,null),0,result,y*getWidth(),getWidth());return result; }
        };
        Result decoded = new com.google.zxing.qrcode.QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)));
        System.out.print(decoded.getText());
    }
}
