export function toolOutputReportsFailure(tool, output) {
  const configuredPattern = tool.failureOutputPattern;
  if (configuredPattern !== undefined) {
    if (typeof configuredPattern !== "string" || configuredPattern.length === 0) {
      throw new Error(`Tool ${tool.name} failureOutputPattern must be a non-empty regular expression string.`);
    }
    return new RegExp(configuredPattern, "iu").test(output);
  }

  return tool.name?.toLowerCase() === "bas2tap" && /\bERROR in line\b/iu.test(output);
}
