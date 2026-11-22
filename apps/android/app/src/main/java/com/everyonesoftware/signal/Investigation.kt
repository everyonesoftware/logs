package com.everyonesoftware.signal

data class LogEvent(val id: String, val time: String, val level: String, val app: String, val message: String, val source: String, val requestId: String)
data class Metric(val app: String, val name: String, val unit: String, val peakTime: String, val windowStart: String, val windowEnd: String, val values: List<Double>)
data class Sample(val end: String, val events: List<LogEvent>, val metric: Metric)

data class Filters(val query: String = "", val app: String = "", val level: String = "", val minutes: Int = 30, val scoped: Boolean = false) {
    fun around(sample: Sample): Filters {
        val requiredSeconds = seconds(sample.end) - seconds(sample.metric.windowStart)
        val range = listOf(10, 30, 60).firstOrNull { it >= minutes && it * 60 >= requiredSeconds } ?: minutes
        return copy(query = "", app = sample.metric.app, level = "", minutes = range, scoped = true)
    }

    fun results(sample: Sample): List<LogEvent> {
        val end = seconds(sample.end)
        val start = end - minutes * 60
        val needle = query.trim()
        return sample.events.filter { event ->
            val time = seconds(event.time)
            time in start..end &&
                (!scoped || (event.app == sample.metric.app && time in seconds(sample.metric.windowStart) until seconds(sample.metric.windowEnd))) &&
                (app.isEmpty() || event.app == app) && (level.isEmpty() || event.level == level) &&
                (event.message.contains(needle, ignoreCase = true) || event.source.contains(needle, ignoreCase = true) || event.requestId.contains(needle, ignoreCase = true))
        }.sortedByDescending { it.time }
    }
}

internal fun seconds(stamp: String): Int {
    val parts = stamp.split(':')
    return parts[0].toInt() * 3600 + parts[1].toInt() * 60 + (parts.getOrNull(2)?.toInt() ?: 0)
}

internal fun stamp(seconds: Int): String {
    val hours = (seconds / 3600).toString().padStart(2, '0')
    val minutes = ((seconds / 60) % 60).toString().padStart(2, '0')
    return "$hours:$minutes"
}
