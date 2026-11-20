import WidgetKit
import SwiftUI

// The Home Screen widget: today's outfit, as the app last saved it.
// It reads a small file the app keeps in a folder both can open.

struct OutfitDay {
    let day: String
    let title: String
    let line: String
    let pictures: [String]
}

struct OutfitEntry: TimelineEntry {
    let date: Date
    let outfit: OutfitDay?
    let emptyText: String
    let images: [UIImage]
}

enum WidgetStore {
    static let group = "group.com.njarrar.wardrobe"

    static var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("widget", isDirectory: true)
    }

    static func dayString(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func load() -> (days: [OutfitDay], emptyText: String) {
        guard let folder,
              let data = try? Data(contentsOf: folder.appendingPathComponent("today.json")),
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return ([], "") }
        let days = (body["days"] as? [[String: Any]] ?? []).compactMap { entry -> OutfitDay? in
            guard let day = entry["day"] as? String else { return nil }
            return OutfitDay(day: day, title: entry["title"] as? String ?? "", line: entry["line"] as? String ?? "", pictures: entry["pictures"] as? [String] ?? [])
        }
        return (days, body["emptyText"] as? String ?? "")
    }

    static func entry(for date: Date) -> OutfitEntry {
        let saved = load()
        let outfit = saved.days.first { $0.day == dayString(date) }
        let images: [UIImage] = (outfit?.pictures ?? []).prefix(4).compactMap { name in
            guard let folder else { return nil }
            return UIImage(contentsOfFile: folder.appendingPathComponent(name).path)
        }
        return OutfitEntry(date: date, outfit: images.isEmpty ? nil : outfit, emptyText: saved.emptyText, images: images)
    }
}

struct OutfitProvider: TimelineProvider {
    func placeholder(in context: Context) -> OutfitEntry {
        OutfitEntry(date: Date(), outfit: nil, emptyText: "", images: [])
    }

    func getSnapshot(in context: Context, completion: @escaping (OutfitEntry) -> Void) {
        completion(WidgetStore.entry(for: Date()))
    }

    // One entry for now and one for the start of each of the next six days,
    // so the widget moves to the next day's outfit on its own.
    func getTimeline(in context: Context, completion: @escaping (Timeline<OutfitEntry>) -> Void) {
        let now = Date()
        let calendar = Calendar.current
        var entries = [WidgetStore.entry(for: now)]
        let startOfToday = calendar.startOfDay(for: now)
        for offset in 1...6 {
            if let next = calendar.date(byAdding: .day, value: offset, to: startOfToday) {
                entries.append(WidgetStore.entry(for: next))
            }
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct PicturesGrid: View {
    let images: [UIImage]

    var body: some View {
        let columns = images.count > 2 ? 2 : max(1, images.count)
        let rows = Int((Double(images.count) / Double(columns)).rounded(.up))
        VStack(spacing: 4) {
            ForEach(0..<rows, id: \.self) { row in
                HStack(spacing: 4) {
                    ForEach(0..<columns, id: \.self) { column in
                        let index = row * columns + column
                        if index < images.count {
                            Image(uiImage: images[index])
                                .resizable()
                                .scaledToFit()
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                }
            }
        }
    }
}

struct OutfitWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: OutfitEntry

    var body: some View {
        if let outfit = entry.outfit {
            if family == .systemMedium {
                HStack(spacing: 12) {
                    PicturesGrid(images: entry.images)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(outfit.title)
                            .font(.headline)
                            .lineLimit(3)
                        if !outfit.line.isEmpty {
                            Text(outfit.line)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(2)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(spacing: 4) {
                    PicturesGrid(images: entry.images)
                    if !outfit.line.isEmpty {
                        Text(outfit.line)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        } else {
            VStack(spacing: 6) {
                Image(systemName: "hanger")
                    .font(.title2)
                    .foregroundColor(.secondary)
                Text(entry.emptyText.isEmpty ? "Wardrobe" : entry.emptyText)
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
            }
        }
    }
}

struct WardrobeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WardrobeToday", provider: OutfitProvider()) { entry in
            OutfitWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today's outfit")
        .description("What to wear today, from your closet.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct WardrobeWidgetBundle: WidgetBundle {
    var body: some Widget {
        WardrobeWidget()
    }
}
