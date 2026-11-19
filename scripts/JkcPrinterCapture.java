import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import jkcemu.Main;
import jkcemu.base.EmuThread;
import jkcemu.base.ScreenFrm;
import jkcemu.print.PrintData;
import jkcemu.print.PrintMngr;

/** Mirror JKCEMU printer jobs to a fresh host file while the emulator is open. */
public class JkcPrinterCapture {
  public static void main(String[] args) throws Exception {
    if (args.length < 1 || args.length > 2) throw new IllegalArgumentException("Expected capture path and optional completion text.");
    Path output = Path.of(args[0]);
    Path staging = output.resolveSibling(output.getFileName() + ".tmp");
    Files.write(output, new byte[0]);
    Main.main(new String[] {"metabasic"});
    byte[] previous = new byte[0];
    long deadline = System.currentTimeMillis() + 120000;
    boolean started = false;
    while (true) {
      ScreenFrm frame = Main.getScreenFrm();
      if (frame != null) {
        started = true;
        EmuThread thread = frame.getEmuThread();
        PrintMngr manager = thread == null ? null : thread.getPrintMngr();
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        if (manager != null) {
          for (int index = 0; index < manager.getRowCount(); index++) {
            PrintData job = manager.getPrintData(index);
            byte[] bytes = job == null ? null : job.getBytes();
            if (bytes != null) data.write(bytes);
          }
        }
        byte[] current = data.toByteArray();
        if (!Arrays.equals(previous, current)) {
          Files.write(staging, current);
          try {
            try {
              Files.move(staging, output, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException unsupported) {
              Files.move(staging, output, StandardCopyOption.REPLACE_EXISTING);
            }
            previous = current;
          } catch (IOException busy) {
            // A host reader may temporarily prevent replacement on Windows.
            // Keep the previous complete snapshot and retry on the next pass.
          }
        }
        if (args.length == 2 && thread != null && thread.getEmuSys() != null) {
          String screen = thread.getEmuSys().getScreenText();
          if (screen != null && screen.contains(args[1]) && Arrays.equals(previous, current)) System.exit(0);
        }
        if (!frame.isDisplayable()) System.exit(0);
      } else if (!started && System.currentTimeMillis() > deadline) {
        throw new IllegalStateException("JKCEMU did not start.");
      }
      Thread.sleep(200);
    }
  }
}
