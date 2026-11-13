package ru.lounge1708.evotorbridge;

import android.content.Context;
import android.content.pm.PackageInfo;

final class AppVersion {
    static String label(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return "Версия " + info.versionName + " · сборка " + info.versionCode;
        } catch (Exception e) { return "Версия приложения недоступна"; }
    }
}
