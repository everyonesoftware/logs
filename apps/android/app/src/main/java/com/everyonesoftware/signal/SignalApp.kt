package com.everyonesoftware.signal

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.launch

internal val Background = Color(0xff101212)
internal val Panel = Color(0xff151818)
internal val Raised = Color(0xff1c201f)
internal val Line = Color(0xff363f3a)
internal val Ink = Color(0xffedf1ed)
internal val Muted = Color(0xffa5afaa)
internal val Mint = Color(0xffa8e5bd)
internal val MintPanel = Color(0xff21372c)
private val scheme = darkColorScheme(primary = Mint, onPrimary = Background, primaryContainer = MintPanel,
    onPrimaryContainer = Mint, background = Background, onBackground = Ink, surface = Panel,
    onSurface = Ink, onSurfaceVariant = Muted, outline = Line, surfaceContainer = Raised, error = Color(0xffffa194))
private val filtersSaver = listSaver<Filters, Any>(
    save = { listOf(it.query, it.app, it.level, it.minutes, it.scoped) },
    restore = { Filters(it[0] as String, it[1] as String, it[2] as String, it[3] as Int, it[4] as Boolean) }
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SignalApp(sample: Sample) {
    var filters by rememberSaveable(stateSaver = filtersSaver) { mutableStateOf(Filters()) }
    var selection by rememberSaveable { mutableStateOf<String?>(null) }
    var settings by rememberSaveable { mutableStateOf(false) }
    val logs = remember(sample, filters) { filters.results(sample) }
    val apps = remember(sample) { sample.events.map { it.app }.distinct().sorted() }
    val state = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val focusById = remember(sample) { sample.events.associate { it.id to FocusRequester() } }
    var returningFocus by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(returningFocus) {
        returningFocus?.let { id ->
            withFrameNanos { }
            if (state.layoutInfo.visibleItemsInfo.any { it.key == id }) focusById[id]?.requestFocus()
            returningFocus = null
        }
    }
    fun closeDetail() {
        returningFocus = selection
        selection = null
    }
    MaterialTheme(colorScheme = scheme) {
        BackHandler(settings) { settings = false }
        Scaffold(
            topBar = { Mast(settings) { settings = !settings } },
            modifier = Modifier.imePadding(),
        ) { insets ->
            Box(Modifier.fillMaxSize().padding(insets), contentAlignment = Alignment.TopCenter) {
                if (settings) {
                    SettingsPage()
                } else {
                    LazyColumn(
                        Modifier.widthIn(max = 720.dp).fillMaxSize().testTag("investigation"),
                        state = state,
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        item("title") {
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Caption("WORKSPACE / INVESTIGATE")
                                Text("Investigate", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                                Text("Search across apps. Trace a metric spike back to its logs.", style = MaterialTheme.typography.bodyMedium, color = Muted)
                            }
                        }
                        item("filters") {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                OutlinedTextField(
                                    value = filters.query,
                                    onValueChange = { filters = filters.copy(query = it) },
                                    modifier = Modifier.fillMaxWidth().testTag("search"),
                                    label = { Text("Search logs") },
                                    placeholder = { Text("Message, request ID, or source") },
                                    leadingIcon = { Icon(Icons.Default.Search, null) },
                                    trailingIcon = if (filters.query.isNotEmpty()) ({ IconButton(onClick = { filters = filters.copy(query = "") }) { Icon(Icons.Default.Close, "Clear search") } }) else null,
                                    shape = RoundedCornerShape(10.dp),
                                    singleLine = true,
                                )
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    FilterMenu("Application", filters.app.ifEmpty { "All apps" }, listOf("" to "All apps") + apps.map { it to it }) { filters = filters.copy(app = it, scoped = false) }
                                    FilterMenu("Severity", severityChoices.first { it.first == filters.level }.second, severityChoices) { filters = filters.copy(level = it) }
                                    FilterMenu("Time range", ranges.getValue(filters.minutes), ranges.map { it.key.toString() to it.value }) { filters = filters.copy(minutes = it.toInt(), scoped = false) }
                                    TextButton(onClick = { filters = Filters() }) { Text("Reset filters") }
                                }
                            }
                        }
                        item("metric") {
                            MetricCard(sample, filters.minutes) {
                                filters = filters.around(sample)
                                scope.launch { state.scrollToItem(3) }
                            }
                        }
                        if (filters.scoped) {
                            item("scope") {
                                Surface(color = MintPanel, shape = RoundedCornerShape(10.dp)) {
                                    Column(Modifier.fillMaxWidth().padding(start = 12.dp, top = 10.dp, end = 12.dp)) {
                                        Text("Metric window · ${sample.metric.app} · ${sample.metric.windowStart.take(5)}–${sample.metric.windowEnd.take(5)} UTC", color = Mint, style = MaterialTheme.typography.bodyMedium)
                                        TextButton(onClick = { filters = filters.copy(scoped = false) }) { Text("Clear window") }
                                    }
                                }
                            }
                        }
                        item("logs") {
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("Logs", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                                Caption("${logs.size} ${if (logs.size == 1) "event" else "events"}")
                                Caption("Newest first · UTC")
                            }
                        }
                        if (logs.isEmpty()) item("empty") {
                            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Panel).padding(16.dp)) {
                                Text("No events match.", style = MaterialTheme.typography.titleMedium)
                                Text("Try a broader time range or clear a filter.", style = MaterialTheme.typography.bodyMedium, color = Muted)
                            }
                        }
                        items(logs, key = { it.id }) { event ->
                            EventRow(event, Modifier.focusRequester(focusById.getValue(event.id))) { selection = event.id }
                        }
                        item("footer") { Caption("Sample timeline ends at ${sample.end.take(5)} UTC") }
                    }
                    logs.firstOrNull { it.id == selection }?.let { Details(it, ::closeDetail) }
                }
            }
        }
    }
}

private val severityChoices = listOf("" to "All severities", "ERROR" to "Errors", "WARN" to "Warnings", "INFO" to "Info")
private val ranges = linkedMapOf(10 to "Last 10 minutes", 30 to "Last 30 minutes", 60 to "Last hour")

@Composable
private fun Mast(settings: Boolean, onAction: () -> Unit) {
    Surface(color = Panel) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            if (settings) {
                IconButton(onClick = onAction) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Text("Settings", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            } else {
                Icon(painterResource(R.drawable.ic_signal), null, modifier = Modifier.size(32.dp), tint = Color.Unspecified)
                Spacer(Modifier.width(9.dp))
                Text("Signal", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text("Sample data", color = Mint, style = MaterialTheme.typography.labelMedium)
                IconButton(onClick = onAction) { Icon(Icons.Default.Settings, "Settings") }
            }
        }
    }
}

@Composable
private fun FilterMenu(name: String, value: String, choices: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.testTag("filter-$name")) { Text("$value ▾") }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            Text(name, Modifier.padding(horizontal = 12.dp, vertical = 6.dp), color = Muted, style = MaterialTheme.typography.labelMedium)
            choices.forEach { (key, label) ->
                DropdownMenuItem(text = { Text(label, color = if (label == value) Mint else Ink) }, onClick = {
                    expanded = false
                    onSelect(key)
                })
            }
        }
    }
}

@Composable
internal fun Caption(text: String, color: Color = Muted) {
    Text(text, color = color, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelMedium, letterSpacing = 0.3.sp)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EventRow(event: LogEvent, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Panel)
        .clickable(role = Role.Button, onClickLabel = "Open event details", onClick = onClick)
        .testTag("event-${event.id}").heightIn(min = 48.dp).padding(horizontal = 13.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Caption(event.time)
            Caption(event.level, levelColor(event.level))
            Caption(event.app)
        }
        Text(event.message, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun levelColor(level: String) = when (level) {
    "ERROR" -> Color(0xffffa194)
    "WARN" -> Color(0xffefca82)
    else -> Mint
}

@Composable
private fun Details(event: LogEvent, onClose: () -> Unit) {
    val close = remember { FocusRequester() }
    Dialog(onDismissRequest = onClose) {
        Surface(shape = RoundedCornerShape(18.dp), color = Raised) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Event details", Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
                    IconButton(onClick = onClose, modifier = Modifier.focusRequester(close)) { Icon(Icons.Default.Close, "Close event details") }
                }
                Caption(event.level, levelColor(event.level))
                Text(event.message, style = MaterialTheme.typography.titleMedium)
                HorizontalDivider(color = Line)
                listOf("Time" to "${event.time} UTC", "Application" to event.app, "Source" to event.source, "Request ID" to event.requestId).forEach { (label, value) ->
                    Column { Caption(label); Text(value, style = MaterialTheme.typography.bodyMedium) }
                }
            }
        }
        LaunchedEffect(Unit) { close.requestFocus() }
    }
}

@Composable
private fun SettingsPage() {
    Column(Modifier.widthIn(max = 720.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Caption("SIGNAL / UPDATES")
        Text("Current Version: ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        OutlinedButton(onClick = {}, enabled = false) { Text("Check for updates") }
        Text("No update feed is configured for this build.", style = MaterialTheme.typography.bodyMedium, color = Muted)
    }
}
