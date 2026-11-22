package com.everyonesoftware.signal

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(0xff101212.toInt()), navigationBarStyle = SystemBarStyle.dark(0xff101212.toInt()))
        val sample = assets.open("sample.json").bufferedReader().use { decodeSample(it.readText()) }
        setContent { LogsApp(sample) }
    }
}

private fun decodeSample(json: String): Sample {
    val root = JSONObject(json)
    val rows = root.getJSONArray("events")
    val events = List(rows.length()) { index ->
        val row = rows.getJSONObject(index)
        LogEvent(row.getString("id"), row.getString("time"), row.getString("level"), row.getString("app"), row.getString("message"), row.getString("source"), row.getString("requestId"))
    }
    val fields = root.getJSONObject("metric")
    val buckets = fields.getJSONArray("values")
    return Sample(root.getString("end"), events, Metric(fields.getString("app"), fields.getString("name"), fields.getString("unit"), fields.getString("peakTime"), fields.getString("windowStart"), fields.getString("windowEnd"), List(buckets.length()) { buckets.getDouble(it) }))
}
