# Cómo publicar Rocío para ti y tus amigos (gratis)

Al terminar tendrás:
- **Un enlace** (`https://TU-USUARIO.github.io/rocio/`) para pasar por WhatsApp. Abre Rocío en cualquier móvil, Android o iPhone, y se instala en la pantalla de inicio como una app.
- **Una app de Android (APK)** para descargar desde la propia Rocío, con avisos automáticos cuando toca regar.

Todo con una cuenta gratuita de GitHub. Para el primer paso necesitas un **ordenador** unos 15 minutos; después, todo se actualiza solo.

---

## 1. Crea tu cuenta y el repositorio
1. Regístrate en https://github.com. El nombre de usuario que elijas formará parte del enlace.
2. Arriba a la derecha pulsa **+ → New repository**.
3. En *Repository name* escribe `rocio`, marca **Public** y pulsa **Create repository**.

## 2. Sube los archivos
1. Descomprime `rocio-proyecto.zip` en tu ordenador.
2. En la página del repositorio pulsa **uploading an existing file**.
3. Abre la carpeta `rocio-proyecto`, selecciona **todo su contenido** (incluida la carpeta `.github`) y arrástralo a la página. Si no ves `.github`, activa en tu ordenador la opción de mostrar archivos ocultos.
4. Abajo pulsa **Commit changes**.

> Si después no aparece nada en la pestaña *Actions*, es que la carpeta `.github` no se subió. Créala a mano: **Add file → Create new file**, escribe como nombre `.github/workflows/publicar.yml`, pega el contenido de ese archivo y pulsa *Commit changes*.

## 3. Activa la web
1. En el repositorio ve a **Settings → Pages**.
2. En *Source* elige **GitHub Actions**.
3. Ve a la pestaña **Actions**, abre «Publicar Rocío» y pulsa **Run workflow** (o espera a que se ejecute solo).

En unos 2 minutos Rocío estará en `https://TU-USUARIO.github.io/rocio/`. Ese es el enlace que pasas a tus amigos.

## 4. Activa también la app de Android con avisos (recomendado)
1. Descomprime `rocio-firma-PRIVADO.zip` y abre `LEEME-secretos.txt`.
2. En el repositorio ve a **Settings → Secrets and variables → Actions → New repository secret** y crea los 4 secretos que indica ese archivo, copiando cada valor tal cual.
3. Vuelve a **Actions → Publicar Rocío → Run workflow**.

En unos 8 minutos aparecerá en *Releases* el archivo `rocio.apk`. Desde ese momento:
- Quien abra Rocío en Android verá en Ajustes **«App de Android con avisos → Descargar»**.
- Al abrir el APK, Android pedirá permitir la instalación desde el navegador. Se acepta una vez y listo.

**Guarda `rocio-firma-PRIVADO.zip` en un sitio seguro y no lo subas nunca a GitHub.** Con esa clave se firman las actualizaciones; si la pierdes, tus amigos tendrían que desinstalar y volver a instalar la app.

---

## Cómo lo instalan tus amigos
- **iPhone:** abrir el enlace en **Safari → Compartir → Añadir a pantalla de inicio**.
- **Android:** abrir el enlace en **Chrome → Instalar**, o descargar el APK desde Ajustes para tener avisos.

La propia app les muestra estos pasos al pulsar «Instalar».

## Recordatorios
- **App de Android (APK):** un aviso al día a la hora elegida, con cada planta y su cantidad de agua.
- **App web (iPhone o Android sin APK):** en *Ajustes → Añadir riegos a mi calendario* se crean los recordatorios de los próximos 14 días en el calendario del móvil. Conviene repetirlo de vez en cuando, porque las fechas cambian con el tiempo que haga.

## Para cambiar algo
Edita los archivos de `src/` directamente en GitHub (icono del lápiz). Al guardar, la web y el APK se vuelven a publicar solos. Las apps de tus amigos se actualizan al abrirlas. Con el APK, cada nueva versión se descarga e instala encima de la anterior.

## IA (opcional, de pago)
Fuera de Claude, la IA necesita una clave de la API de Anthropic, que se paga por uso. Si algún día la quieres:
1. Despliega `ai-proxy/` en Cloudflare Workers (gratis) con tu clave.
2. Crea `src/ai.json` con `{"aiEndpoint": "https://...", "aiKey": "..."}`.

Sin esto, la app funciona completa y simplemente no muestra las funciones de IA.

## Datos y privacidad
Cada persona guarda sus plantas en su propio móvil; nadie más puede verlas. El tiempo viene de Open-Meteo, gratuito para uso no comercial como este.
