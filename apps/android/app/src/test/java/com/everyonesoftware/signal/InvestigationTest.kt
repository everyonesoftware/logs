package com.everyonesoftware.signal

import org.junit.Assert.assertEquals
import org.junit.Test

class InvestigationTest {
    private val metric = Metric("Music", "HTTP error rate", "%", "14:32", "14:30:00", "14:35:00", listOf(1.0, 2.0))
    private fun event(time: String, app: String = "Music", level: String = "ERROR") =
        LogEvent(time, time, level, app, "Upstream timeout", "library-api", "req-ABC")
    private val sample = Sample("14:42:00", listOf(event("14:30:00"), event("14:35:00"), event("14:32:00", "Tasks"), event("14:29:59"), event("14:04:00"), event("14:34:00", level = "WARN"), event("14:43:00")), metric)

    @Test fun searchCombinesAppSeverityAndRangeAndSortsNewestFirst() {
        val filters = Filters(query = "  REQ-abc ", app = "Music", level = "ERROR")
        assertEquals(listOf("14:35:00", "14:30:00", "14:29:59"), filters.results(sample).map { it.time })
        assertEquals(listOf("14:35:00"), filters.copy(minutes = 10, query = "library-API").results(sample).map { it.time })
        assertEquals(4, filters.copy(minutes = 60, query = "TIMEOUT").results(sample).size)
        assertEquals(emptyList<LogEvent>(), filters.copy(query = "not found").results(sample))
    }

    @Test fun spikeReplacesConflictingFiltersAndUsesHalfOpenWindow() {
        val filters = Filters(query = "missing", app = "Tasks", level = "INFO", minutes = 10).around(sample)
        assertEquals(Filters(app = "Music", scoped = true), filters)
        assertEquals(listOf("14:34:00", "14:30:00"), filters.results(sample).map { it.time })
        assertEquals(listOf("14:35:00", "14:34:00", "14:30:00", "14:29:59"), filters.copy(scoped = false).results(sample).map { it.time })
    }
}
