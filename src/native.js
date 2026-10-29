// Puente a las funciones nativas de Android (Capacitor). Se empaqueta con esbuild.
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Geolocation } from "@capacitor/geolocation";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { SplashScreen } from "@capacitor/splash-screen";
import { Share } from "@capacitor/share";
import { App } from "@capacitor/app";
window.RocioNative = { Capacitor, SystemBars, SystemBarsStyle, LocalNotifications, Geolocation, Haptics, ImpactStyle, NotificationType, SplashScreen, Share, App };
