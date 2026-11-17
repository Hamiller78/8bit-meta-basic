import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import jkcemu.Main;
import jkcemu.base.EmuSys;
import jkcemu.base.ScreenFrm;

/** Run JKCEMU with the staged profile and save the final native screen text. */
public class JkcScreenCapture {
  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("Expected capture path and timeout in milliseconds.");
    Path output = Path.of(args[0]);
    long deadline = System.currentTimeMillis() + Long.parseLong(args[1]);
    Main.main(new String[] {"metabasic"});
    String last = "";
    long errorSeen = 0;
    while (System.currentTimeMillis() < deadline) {
      ScreenFrm frame = Main.getScreenFrm();
      EmuSys system = frame != null && frame.getEmuThread() != null ? frame.getEmuThread().getEmuSys() : null;
      String text = system == null ? null : system.getScreenText();
      if (text != null && !text.equals(last)) {
        last = text;
        Files.writeString(output, text, StandardCharsets.UTF_8);
      }
      if (text != null) {
        String compact = text.replaceAll("\\s+", "");
        if (compact.contains("RUNFINISHED") && compact.matches("(?s).*FREEMEMORY:[0-9]+.*")) System.exit(0);
        if (text.matches("(?is).*\\?[A-Z]{1,4}\\s+ERROR[\\s\\S]*")) {
          if (errorSeen == 0) errorSeen = System.currentTimeMillis();
          if (System.currentTimeMillis() - errorSeen >= 2000) {
            System.err.println("KC 85 BASIC reported an error; see " + output);
            System.exit(2);
          }
        } else errorSeen = 0;
      }
      Thread.sleep(500);
    }
    System.err.println("Timed out waiting for a complete KC 85 test summary: " + output);
    System.exit(1);
  }
}
