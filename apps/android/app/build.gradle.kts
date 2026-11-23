plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.everyonesoftware.signal"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.everyonesoftware.signal"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.gradleProperty("logsVersionCode").map(String::toInt).getOrElse(1)
        versionName = providers.gradleProperty("logsVersionName").getOrElse("0.1.0")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

abstract class PackageSample : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sampleFile: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @TaskAction
    fun packageSample() {
        sampleFile.get().asFile.copyTo(outputDirectory.file("sample.json").get().asFile, overwrite = true)
    }
}

androidComponents.onVariants { variant ->
    val task = tasks.register<PackageSample>("package${variant.name.replaceFirstChar { it.uppercaseChar() }}Sample") {
        sampleFile.set(rootProject.layout.projectDirectory.file("../../contracts/sample.json"))
    }
    variant.sources.assets?.addGeneratedSourceDirectory(task, PackageSample::outputDirectory)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.11.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
