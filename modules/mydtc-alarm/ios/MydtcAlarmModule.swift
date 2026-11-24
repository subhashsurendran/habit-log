import ExpoModulesCore

#if canImport(AlarmKit)
import AlarmKit
import SwiftUI

struct MydtcAlarmMetadata: AlarmMetadata {
  var label: String
}

@available(iOS 26.1, *)
@MainActor
enum MydtcAlarmKit {
  static func authorization() -> String {
    switch AlarmManager.shared.authorizationState {
    case .authorized:
      return "allowed"
    case .denied:
      return "denied"
    case .notDetermined:
      return "unknown"
    @unknown default:
      return "unknown"
    }
  }

  static func authorize() async -> String {
    let current = authorization()
    if current == "allowed" || current == "denied" {
      return current
    }
    do {
      let next = try await AlarmManager.shared.requestAuthorization()
      return next == .authorized ? "allowed" : "denied"
    } catch {
      return "denied"
    }
  }

  static func weekday(_ value: Int) -> Locale.Weekday? {
    switch value {
    case 1: return .sunday
    case 2: return .monday
    case 3: return .tuesday
    case 4: return .wednesday
    case 5: return .thursday
    case 6: return .friday
    case 7: return .saturday
    default: return nil
    }
  }

  static func schedule(
    id: String,
    hour: Int,
    minute: Int,
    title: String,
    skipWeekday: Int,
    prompt: Bool
  ) async -> String {
    guard let uuid = UUID(uuidString: id) else { return "unavailable" }
    guard hour >= 0, hour <= 23, minute >= 0, minute <= 59 else { return "unavailable" }
    let auth = prompt ? await authorize() : authorization()
    if auth != "allowed" {
      return auth == "denied" ? "denied" : "unknown"
    }
    let label = title.trimmingCharacters(in: .whitespacesAndNewlines)
    let shown = label.isEmpty ? "MyDTC" : String(label.prefix(80))
    let alert = AlarmPresentation.Alert(
      title: LocalizedStringResource(stringLiteral: shown)
    )
    let presentation = AlarmPresentation(alert: alert)
    let attributes = AlarmAttributes<MydtcAlarmMetadata>(
      presentation: presentation,
      metadata: MydtcAlarmMetadata(label: shown),
      tintColor: Color(red: 0.45, green: 0.32, blue: 0.72)
    )
    var days: [Locale.Weekday] = [
      .sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday,
    ]
    if let drop = weekday(skipWeekday) {
      days.removeAll { $0 == drop }
    }
    guard !days.isEmpty else { return "unavailable" }
    let schedule = Alarm.Schedule.relative(
      Alarm.Schedule.Relative(
        time: Alarm.Schedule.Relative.Time(hour: hour, minute: minute),
        repeats: .weekly(days)
      )
    )
    let config = AlarmManager.AlarmConfiguration(
      countdownDuration: Alarm.CountdownDuration(preAlert: nil, postAlert: nil),
      schedule: schedule,
      attributes: attributes,
      sound: .default
    )
    do {
      _ = try await AlarmManager.shared.schedule(id: uuid, configuration: config)
      return "alarm"
    } catch {
      return "unavailable"
    }
  }

  static func cancel(id: String) {
    guard let uuid = UUID(uuidString: id) else { return }
    try? AlarmManager.shared.cancel(id: uuid)
  }

  static func armed(id: String) -> Bool {
    guard let uuid = UUID(uuidString: id) else { return false }
    guard let alarms = try? AlarmManager.shared.alarms else { return false }
    return alarms.contains { $0.id == uuid }
  }
}
#endif

func mydtcAlarmKitAvailable() -> Bool {
  #if canImport(AlarmKit)
  if #available(iOS 26.1, *) {
    return true
  }
  #endif
  return false
}

public class MydtcAlarmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MydtcAlarm")

    Function("available") { () -> Bool in
      mydtcAlarmKitAvailable()
    }

    AsyncFunction("authorization") { () async -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.1, *) {
        return await MydtcAlarmKit.authorization()
      }
      #endif
      return "missing"
    }

    AsyncFunction("schedule") {
      (id: String, hour: Int, minute: Int, title: String, skipWeekday: Int, prompt: Bool) async -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.1, *) {
        return await MydtcAlarmKit.schedule(
          id: id,
          hour: hour,
          minute: minute,
          title: title,
          skipWeekday: skipWeekday,
          prompt: prompt
        )
      }
      #endif
      return "missing"
    }

    AsyncFunction("cancel") { (id: String) async in
      #if canImport(AlarmKit)
      if #available(iOS 26.1, *) {
        await MydtcAlarmKit.cancel(id: id)
      }
      #endif
    }

    AsyncFunction("armed") { (id: String) async -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.1, *) {
        return await MydtcAlarmKit.armed(id: id)
      }
      #endif
      return false
    }
  }
}
