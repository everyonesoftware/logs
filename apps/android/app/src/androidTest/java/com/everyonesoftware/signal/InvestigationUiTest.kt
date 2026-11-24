package com.everyonesoftware.signal

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class InvestigationUiTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun opensSpikeLogsAndInspectsAnEventThenReturns() {
        ui.onNodeWithText("Sample data").assertIsDisplayed()
        ui.onNodeWithTag("investigation").performScrollToNode(hasTestTag("spike"))
        ui.onNodeWithTag("spike").performClick()
        ui.onNodeWithTag("investigation").performScrollToNode(hasText("Metric window · Music · 14:30–14:35 UTC"))
        ui.onNodeWithTag("investigation").performScrollToNode(hasText("7 events"))
        ui.onNodeWithTag("investigation").performScrollToNode(hasTestTag("event-e10"))
        ui.onNodeWithTag("event-e10").performClick()
        ui.onNodeWithText("Event details").assertIsDisplayed()
        ui.onNodeWithText("req-74a2").assertIsDisplayed()
        InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("input keyevent 4").use { }
        ui.waitUntil(5_000) { ui.onAllNodesWithText("Event details").fetchSemanticsNodes().isEmpty() }
        ui.onNodeWithTag("event-e10").assertIsDisplayed()
        ui.onNodeWithTag("investigation").performScrollToNode(hasText("Clear window"))
        ui.onNodeWithText("Clear window").performClick()
        ui.onNodeWithTag("investigation").performScrollToNode(hasText("9 events"))
    }

    @Test fun searchEmptyAndResetThenSettingsShowsNoFeed() {
        ui.onNodeWithTag("search").performTextInput("nothing matches")
        ui.onNodeWithTag("investigation").performScrollToNode(hasText("No events match."))
        ui.onNodeWithTag("investigation").performScrollToNode(hasText("Reset filters"))
        ui.onNodeWithText("Reset filters").performClick()
        ui.onNodeWithTag("investigation").performScrollToNode(hasText("15 events"))
        ui.onNodeWithContentDescription("Settings").performClick()
        val installedVersion = ui.activity.packageManager.getPackageInfo(ui.activity.packageName, 0).versionName
        ui.onNodeWithText("Current Version: $installedVersion").assertIsDisplayed()
        ui.onNodeWithText("Check for updates").assertIsNotEnabled()
        ui.onNodeWithContentDescription("Back").performClick()
        ui.onNodeWithText("Sample data").assertIsDisplayed()
    }

    @Test fun settingsOverviewHandsOffApiKeyManagementToWeb() {
        ui.onNodeWithTag("search").performTextInput("req-74a2")
        ui.onNodeWithContentDescription("Settings").performClick()

        val handoff = ui.onNodeWithText("Create and manage API keys in Logs on the web.")
        handoff.assertExists().performScrollTo().assertIsDisplayed().assertHasNoClickAction()
        ui.onNodeWithText("API keys").assertIsDisplayed().assertHasNoClickAction()
        ui.onNodeWithText("Create API key").assertDoesNotExist()
        ui.onNodeWithText("Revoke", substring = true).assertDoesNotExist()
        ui.onNodeWithContentDescription("Back").performClick()
        ui.onNodeWithTag("search").assertTextContains("req-74a2")
    }
}
