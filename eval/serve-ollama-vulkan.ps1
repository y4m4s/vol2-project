# Dedicated evaluation service. Environment changes apply only to this process.
# Run in a separate PowerShell process; Ctrl+C stops the service.
param([ValidateRange(1024,65535)][int]$Port = 11435)
$ErrorActionPreference = 'Stop'
$taskOllamaExe = (Get-Command ollama -ErrorAction Stop).Source
$taskVulkanDll = Join-Path (Split-Path $taskOllamaExe) 'lib\ollama\vulkan\ggml-vulkan.dll'
if (-not (Test-Path -LiteralPath $taskVulkanDll)) { throw 'Installed Ollama Vulkan backend was not found.' }
$taskOverrides = @{
    OLLAMA_HOST = "127.0.0.1:$Port"
    OLLAMA_VULKAN = '1'
    OLLAMA_NOPRUNE = '1'
    OLLAMA_MAX_LOADED_MODELS = '1'
    GGML_BACKEND_PATH = $taskVulkanDll
}
$taskPrevious = @{}
try {
    foreach ($taskKey in $taskOverrides.Keys) {
        $taskPrevious[$taskKey] = [Environment]::GetEnvironmentVariable($taskKey, 'Process')
        [Environment]::SetEnvironmentVariable($taskKey, $taskOverrides[$taskKey], 'Process')
    }
    & $taskOllamaExe serve
    if ($LASTEXITCODE -ne 0) { throw "Ollama exited with code $LASTEXITCODE" }
} finally {
    foreach ($taskKey in $taskPrevious.Keys) {
        [Environment]::SetEnvironmentVariable($taskKey, $taskPrevious[$taskKey], 'Process')
    }
}
