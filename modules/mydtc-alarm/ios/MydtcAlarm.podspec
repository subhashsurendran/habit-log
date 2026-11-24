require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

def mydtc_alarm_kit(sdk)
  root = `xcrun --sdk #{sdk} --show-sdk-path 2>/dev/null`.strip
  return false if root.empty?

  File.directory?(File.join(root, "System/Library/Frameworks/AlarmKit.framework"))
end

Pod::Spec.new do |s|
  s.name           = "MydtcAlarm"
  s.version        = package["version"]
  s.summary        = package["description"]
  s.description    = package["description"]
  s.license        = package["license"]
  s.author         = "MyDTC"
  s.homepage       = "https://mydtc-app.com"
  s.platforms      = { :ios => "16.4" }
  s.swift_version  = "5.9"
  s.source         = { git: "" }
  s.static_framework = true
  s.dependency "ExpoModulesCore"
  s.source_files = "**/*.{h,m,swift}"

  # Link only when this Mac's iOS SDK actually ships AlarmKit. Weak so an
  # older phone still launches. The Swift side checks canImport as well.
  if mydtc_alarm_kit("iphoneos") || mydtc_alarm_kit("iphonesimulator")
    s.weak_frameworks = "AlarmKit"
  end

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_COMPILATION_MODE" => "wholemodule"
  }
end
