package com.everyonesoftware.signal

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun MetricCard(sample: Sample, minutes: Int, onSpike: () -> Unit) {
    val metric = sample.metric
    val end = seconds(sample.end)
    val start = end - minutes * 60
    val peak = seconds(metric.peakTime)
    val showPeak = peak in start..end
    val values = metric.values
    val firstBucket = end - (values.size - 1) * 60
    val buckets = values.mapIndexedNotNull { index, value ->
        val time = firstBucket + index * 60
        if (time in start..end) ((time - start) / (minutes * 60f)) to value else null
    }
    Surface(color = Panel, shape = RoundedCornerShape(12.dp)) {
        Column(Modifier.fillMaxWidth().padding(13.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Metric timeline", style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            Text("${metric.app} · ${metric.name}", style = MaterialTheme.typography.bodyMedium, color = Muted)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${values.last()}${metric.unit}", color = Mint, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            }
            if (showPeak) Caption("Peak ${values.max()}${metric.unit} · ${metric.peakTime} UTC", Mint)
            val chartDescription = if (showPeak) "${metric.name} with a spike at ${metric.peakTime} UTC" else "${metric.name}, no spike in range"
            Canvas(Modifier.fillMaxWidth().height(104.dp).semantics { contentDescription = chartDescription }) {
                val floor = size.height - 1.dp.toPx()
                val top = 6.dp.toPx()
                repeat(4) { grid ->
                    val y = top + (floor - top) * grid / 3
                    drawLine(Line, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx())
                }
                if (showPeak) {
                    val x = size.width * (peak - start) / (minutes * 60f)
                    drawLine(Muted.copy(alpha = 0.55f), Offset(x, top), Offset(x, floor), strokeWidth = 1.dp.toPx())
                }
                val max = values.max().coerceAtLeast(1.0)
                val line = Path()
                val area = Path()
                buckets.forEachIndexed { index, (fraction, value) ->
                    val x = fraction * size.width
                    val y = floor - ((floor - top) * value / max).toFloat()
                    if (index == 0) {
                        line.moveTo(x, y)
                        area.moveTo(x, floor)
                    } else line.lineTo(x, y)
                    area.lineTo(x, y)
                }
                area.lineTo(size.width, floor)
                area.close()
                drawPath(area, Brush.verticalGradient(listOf(Mint.copy(alpha = .30f), Mint.copy(alpha = .04f))))
                drawPath(line, Mint, style = Stroke(width = 2.dp.toPx()))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Caption(stamp(start))
                Caption(stamp(start + minutes * 30))
                Caption("${stamp(end)} UTC")
            }
            if (showPeak) {
                FilledTonalButton(onClick = onSpike, modifier = Modifier.fillMaxWidth().testTag("spike")) {
                    Text("Show ${metric.app} logs around ${metric.peakTime}")
                }
            } else {
                Caption("No incident spike in this window.")
            }
        }
    }
}
