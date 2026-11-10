import { mkdirSync, writeFileSync } from "node:fs";

const count = 200;
const paddingLines = 300;

function branchBlock(place) {
  return `${place}_control:
started=jiffies()
for iteration=1 to ${count}
next iteration
elapsed=jiffies()-started
return
${place}_forward:
counter=0
started=jiffies()
for iteration=1 to ${count}
counter=counter+1
goto ${place}_forward_target
dead=dead+1
${place}_forward_target:
next iteration
elapsed=jiffies()-started
return
${place}_backward:
started=jiffies()
counter=0
${place}_backward_target:
counter=counter+1
if counter<${count} then
goto ${place}_backward_target
end if
elapsed=jiffies()-started
return
${place}_caller:
started=jiffies()
for iteration=1 to ${count}
gosub early_empty
next iteration
elapsed=jiffies()-started
return
${place}_empty:
return
`;
}

const padding = Array.from({ length: paddingLines }, (_, index) => `padding_${index}:\ndead=dead+1\n`).join("");
const targets = [["spectrum", "TEXT_PRINTER"], ["c64", "RS232"], ["atari800xl", "SHARED_DRIVE"]];
mkdirSync("build/branch-layout", { recursive: true });

for (const [target, device] of targets) {
  const source = `program_mode
open_device results, ${device}
dead=0
goto runner
${branchBlock("early")}call_early:
started=jiffies()
for iteration=1 to ${count}
gosub early_empty
next iteration
elapsed=jiffies()-started
return
call_late:
started=jiffies()
for iteration=1 to ${count}
gosub late_empty
next iteration
elapsed=jiffies()-started
return
goto after_padding
${padding}after_padding:
${branchBlock("late")}runner:
print_device results; "BRANCH LAYOUT ${count}"
gosub early_control
print_device results; "CONTROL EARLY ";elapsed
gosub late_control
print_device results; "CONTROL LATE ";elapsed
gosub early_forward
print_device results; "FORWARD EARLY ";elapsed
print_device results; "COUNT ";counter
print_device results; "SKIPPED ";dead
gosub late_forward
print_device results; "FORWARD LATE ";elapsed
print_device results; "COUNT ";counter
print_device results; "SKIPPED ";dead
gosub early_backward
print_device results; "BACKWARD EARLY ";elapsed
gosub late_backward
print_device results; "BACKWARD LATE ";elapsed
gosub call_early
print_device results; "DEST EARLY ";elapsed
gosub call_late
print_device results; "DEST LATE ";elapsed
gosub early_caller
print_device results; "CALLER EARLY ";elapsed
gosub late_caller
print_device results; "CALLER LATE ";elapsed
print_device results; "DONE"
close_device results
end
`;
  writeFileSync(`build/branch-layout/${target}.mbas`, source);
}
