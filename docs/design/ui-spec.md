# whatcrow: especificación de interfaz

Versión 2 · 2026-10-19 · Fuente funcional: `docs/superpowers/specs/2026-10-19-whatcrow-overlay-design.md` §7
Mockup navegable: `mockup.html` (misma carpeta). Los datos de ejemplo son inventados.

Cambios respecto de la v1:
- paleta verde (§8.1);
- id copiable en cada tarjeta (§5.5);
- fila de acciones con posiciones fijas y scroll que no la tapa (§5.6);
- breakpoints de la tarjeta según su propio ancho (§3.4).

---

## 1. Objetivo y usuario

**Objetivo.** Aprobar, programar o descartar en segundos las respuestas de WhatsApp que deja el agente, sin cambiar de ventana y sin que salga nada por un clic accidental.

**Usuario.** Erick, Windows 11 en español (Perú). Trabaja en otra app a pantalla completa y mira la columna de reojo. Tiene de 0 a 30 sugerencias pendientes. Usa teclado y mouse por igual. Cuando quiere que el agente corrija un borrador, se lo pide a Claude citando el id ("en la respuesta #147 considera X").

**Qué tiene que leer en un vistazo (≤ 1 s):**
1. Cuántas cosas esperan su decisión y si alguna falló.
2. En cada tarjeta: de quién es, de qué tipo es, su id y cuál es la acción principal.
3. Si algo del sistema está roto (base, WhatsApp, agente).

---

## 2. Tareas por frecuencia

| # | Tarea | Frecuencia | Dónde |
|---|-------|-----------|-------|
| 1 | Enviar una sugerencia tal cual | Muy alta | Tarjeta → Enviar |
| 2 | Corregir el borrador y enviarlo | Alta | Tarjeta → editor → Enviar |
| 3 | Descartar una tarea o un "esperando" | Alta | Tarjeta → Descartar |
| 4 | Copiar el id para pedirle un ajuste a Claude | Media | Tarjeta → `#147` |
| 5 | Programar una respuesta | Media | Tarjeta → Programar |
| 6 | Decidir sobre una sugerencia desactualizada | Media | Aviso naranja → Enviar igual / editar |
| 7 | Mirar o cancelar lo programado | Baja | Programados |
| 8 | Reintentar un envío fallido o vencido | Baja | Fallidos |
| 9 | Cambiar el tamaño de la ventana | Baja | Control de tamaño / borde |
| 10 | Buscar actualizaciones, cambiar la ruta de la base | Muy baja | Ajustes |

---

## 3. Ventana y layout

### 3.1 Tamaños
| Concepto | Valor | Nota |
|----------|-------|------|
| Mínimo usable | **300 × 360 px** | `minWidth`/`minHeight` de Tauri. Es el mínimo en el que la fila de acciones entra junto con el gutter de la barra de scroll (§5.6). |
| Por defecto | **330 × 660 px** | Dos notas adhesivas apiladas. |
| Modo contador | **184 × 48 px** | Píldora siempre encima, activada por el usuario. |

### 3.2 Control de tamaño rápido
| Preset | Tamaño | Atajo | Breakpoints |
|--------|--------|-------|-------------|
| Contador | 184 × 48 | `Ctrl+0` | vista contador |
| Compacto | 330 × 440 | `Ctrl+1` | angosto + alto bajo |
| Normal | 330 × 660 | `Ctrl+2` | angosto + alto medio |
| Amplio | 760 × 660 | `Ctrl+3` | lista + detalle |

- Con menos de 480 px de ancho, un botón de icono abre el menú de presets. Desde 480 px se ve un control segmentado.
- La ventana se ancla al borde: si estaba pegada (≤ 16 px) al borde derecho de la pantalla, crece hacia la izquierda.
- El tamaño elegido a mano se recuerda entre sesiones.

### 3.3 Breakpoints de la ventana

**Ancho**
| Rango | Nombre | Layout |
|-------|--------|--------|
| 300–379 | Angosto | Una columna. Pestañas con texto de 12 px y relleno reducido. Tamaño por menú. |
| 380–599 | Angosto+ | Se suma el filtro por categoría. Los atajos van solo en el tooltip: nunca dentro del botón, porque cambiarían su ancho. |
| 600–959 | Lista + detalle | Lista de 280 px fijos + detalle (relleno lateral 12 px). |
| ≥ 960 | Tres columnas | Lista 300 · detalle · lateral 300 con Programados y Fallidos. Esas dos pestañas desaparecen. |

**Alto**
| Rango | Nombre | Cambios |
|-------|--------|---------|
| 360–479 | Bajo | Acordeón: cada fila mide ~52 px (nombre, categoría, id, hora, último mensaje). Solo la abierta muestra el cuerpo. Barra de título de 36 px y botones de 28 px. Sin barra de estado: el punto de salud pasa junto al logo. Se ve un banner más "n avisos más". Borrador hasta 3 líneas. |
| 480–799 | Medio | Tarjetas completas. Último mensaje hasta 3 líneas. Borrador hasta 5 líneas. |
| ≥ 800 | Alto | Último mensaje y nota completos. Borrador hasta 12 líneas. |

### 3.4 Breakpoint de la tarjeta (según su propio ancho)
La fila de acciones depende del **ancho de la tarjeta** (container query sobre `.card`), no del de la ventana. Así se comporta igual en una columna, en el detalle de 600 px (más angosto que la columna de 380) y en tres columnas.

| Ancho de tarjeta | Programar |
|------------------|-----------|
| < 340 px | Icono de reloj de 32 × 32, con `aria-label="Programar"` y tooltip "Programar (P)". |
| ≥ 340 px | Botón con texto. |

Ancho de la tarjeta en el peor caso (gutter clásico de 17 px):

| Ventana | Tarjeta | Programar |
|---------|---------|-----------|
| 300 | 267 | icono |
| 330 | 297 | icono |
| 380 | 347 | texto |
| 600 (detalle) | 279 | icono |
| 960 (detalle) | 311 | icono |

### 3.5 Qué se oculta o colapsa
| Elemento | 300–379 | 380–599 | 600–959 | ≥ 960 | Alto bajo |
|----------|---------|---------|---------|-------|-----------|
| Pestañas Programados/Fallidos | sí | sí | sí | no (columna) | sí |
| Filtro por categoría | no | sí | sí | sí | no |
| Control de tamaño | menú | segmentado desde 480 | segmentado | segmentado | según ancho |
| Barra de estado | sí | sí | sí | sí | no |
| Borrador en la lista | completo | completo | vista previa de 1 línea | 1 línea | solo en la abierta |
| Id de la sugerencia | sí | sí | sí (lista y detalle) | sí | sí (en la fila cerrada) |

---

## 4. Anatomía

```
┌ barra de título (arrastrable) ─────────────────┐
│ [cuervo] whatcrow  ●          [▢] [⚙] [–] [×]  │
├ banners (solo si hay problemas) ───────────────┤
├ Pendientes 9 │ Programados 2 │ Fallidos 2 ─────┤
│ ┃ Rosa Quispe     Responder  [#147]    10:42 ░│ ← ░ = gutter reservado
│ ┃ «¿Me confirmas si el pedido sale mañana?» ░│
│ ┃ ⓘ nota del agente                          ░│
│ ┃ ┌ borrador ───────────────────────────────┐░│
│ ┃ │                   Editado  Restaurar    │░│
│ ┃ └─────────────────────────────────────────┘░│
│ ┃ Descartar          [⏱] [     Enviar     ] ░│
├ barra de estado ───────────────────────────────┤
│ ● Agente hace 3 min   ● WhatsApp ok   10:42:15 │
└────────────────────────────────────────────────┘
```
- Cada tarjeta tiene una franja de 3 px con el color de la categoría y su etiqueta de texto.
- Orden: más reciente primero. Las desactualizadas no se mueven.
- En los grupos se muestran un icono y el remitente. `[×]` oculta la ventana en la bandeja.

---

## 5. Componentes y estados

### 5.1 Barra de título
| Estado | Comportamiento |
|--------|----------------|
| Normal | Logo verde, nombre y punto de salud con `aria-label`. |
| Foco | Anillo de 2 px y tooltip con el atajo. |
| Actualización disponible | Punto de acento en el engranaje. |

### 5.2 Banners de sistema
| Banner | Severidad | Texto | Acción | Efecto |
|--------|-----------|-------|--------|--------|
| Base no encontrada | Bloqueante | El contenido se reemplaza por "No encuentro la base de datos" y la ruta. | Elegir archivo… · Reintentar | Todo deshabilitado. |
| WhatsApp no saludable | Error | "WhatsApp está desconectado. Lo que envíes queda en cola y sale cuando vuelva." | Detalles | El toast dice "En cola". |
| Agente sin señales > 20 min | Aviso (`--warn`) | "El agente no da señales desde las 10:05 (hace 38 min). No van a llegar sugerencias nuevas." | Copiar comando de arranque | — |
| Datos desactualizados (lectura falla > 10 s) | Aviso (`--warn`) | "Sin lectura de la base desde 10:41:02. Reintentando… Enviar está en pausa." | — | Se deshabilitan Enviar, Programar, Reintentar y Descartar. |

### 5.3 Pestañas
- Cada pestaña lleva su contador. Fallidos usa color de error y el número como texto.
- Llevan `role="tablist"`.
- Si no entran, la fila hace scroll horizontal fino; las etiquetas nunca se cortan.

### 5.4 Tarjeta de sugerencia

**Variantes**
| Categoría | Contenido | Acciones |
|-----------|-----------|----------|
| Responder | Último mensaje, nota, borrador editable | Descartar · Programar · **Enviar** |
| Tarea | Último mensaje, nota | Descartar |
| Esperando | Último mensaje, nota | Descartar |

**Estados**
| Estado | Disparador | Qué cambia |
|--------|------------|------------|
| Reposo | — | Como en la anatomía. |
| Foco | Tab, ↑/↓, J/K | Anillo de 2 px. La tarjeta se desplaza hasta verse entera, con sus botones (§5.6). |
| Seleccionada (≥ 600) | Clic o foco | En la lista: fondo `--accent-soft` y borde de acento. |
| Abierta (alto bajo) | Clic, Enter | Se expande en su lugar. |
| Editando | Foco en el borrador | Borde de acento. Si hay cambios, aparece "Editado · Restaurar" **dentro** del editor, abajo a la derecha (el editor reserva 22 px), así la fila no baja al escribir. Los atajos de una letra quedan inactivos. |
| Borrador vacío | El usuario borra todo | Enviar y Programar pasan a `aria-disabled` y el tooltip explica por qué. |
| Desactualizada | Llega un mensaje después de `last_msg_id` | Aparece un bloque naranja "Mensaje nuevo · 10:51" y la franja se vuelve naranja. **Enviar** pasa a **Enviar igual**: mismo slot, contorno naranja. Por teclado: `Ctrl+Shift+Enter`. |
| Sugerencia nueva mientras edita | El loop la reemplazó | Aviso "Hay una sugerencia nueva (10:55). Tu texto no se tocó." con Ver, Usar la nueva y Seguir con la mía. Al elegir, la tarjeta adopta el id nuevo (§5.5). |
| Actualizada (sin edición) | El loop la reemplazó | Se reemplaza el contenido. Durante 10 s se ve "Actualizada 11:02 · reemplaza a #146" y el chip del id queda resaltado. |
| Programando | Programar o `P` | El selector (§5.8) reemplaza la fila. |
| Enviando (5 s) | Enviar o `Ctrl+Enter` | Cuenta regresiva con Deshacer en el slot de Enviar (§6). |
| Error al enviar | La transacción afectó 0 filas | Bloque rojo "No se envió…" con Cerrar. |
| Deshabilitada | Datos viejos o sin base | Acciones al 45 % de opacidad, con `aria-disabled` y el motivo. |
| Saliendo | Enviada, programada o descartada | Colapsa en 160 ms y el foco pasa a la siguiente. |

### 5.5 Id de la sugerencia
- **Formato:** `#` + `suggestions.id` (`#147`), con cifras tabulares.
- **Ubicación:** en la cabecera, entre la categoría y la hora. Es el mismo lugar en todos los layouts: columna, fila cerrada del acordeón, lista (≥ 600), detalle y tres columnas. Solo se trunca el nombre del chat (con tooltip del nombre completo).
- **Aspecto:**
  - Reposo: chip de 24 px de alto, borde `--line`, texto `--muted` de 12 px y peso 500.
  - Hover: borde `--muted`, texto `--ink` y cursor de copiar.
  - El ancho no cambia entre estados.
- **Copiar:**
  - Con un clic en el chip o con `C` sobre la tarjeta enfocada, copia `#147` y muestra el toast "Copiado #147".
  - El clic no selecciona ni abre la tarjeta.
  - Si falla: "No se pudo copiar. Selecciona el id y usa Ctrl+C."
- **Lector de pantalla:**
  - El chip es `<button aria-label="Copiar id 147">`.
  - La tarjeta lo incluye en su `aria-describedby`: "Responder, id 147, 10:42".
  - El toast se anuncia en la región `polite`.
- **Reemplazo:** el chip pasa al id nuevo. Durante 10 s aparece "Actualizada 11:02 · reemplaza a #146" con el chip en `--accent-soft`, y se anuncia "Sugerencia actualizada: ahora es la #160, reemplaza a la #146".

### 5.6 Fila de acciones y scroll

**Posiciones fijas.** Enviar ocupa siempre el mismo rectángulo, pegado al borde derecho. Lo que lo reemplaza en otros estados tiene el mismo tamaño.
```
Responder:   [Descartar] ·········· [Programar|⏱] [ Enviar        108 ]
Desactual.:  [Descartar] ·········· [Programar|⏱] [ Enviar igual  108 ]
Enviando:    Enviando a Rosa Quispe en 4 s ······ [ Deshacer      108 ]
Programando: (selector arriba)  [Volver] ········ [ Programar     108 ]
Tarea/Esp.:  [Descartar]
```
- **Slot derecho:** 108 × 32 px fijos (28 de alto con alto bajo), texto centrado. Lo comparten Enviar, Enviar igual, Deshacer, el Programar del selector y Reintentar.
- **Descartar:** fantasma de unos 80 px, siempre a la izquierda.
- **Programar:** unos 82 px con texto, o 32 px como icono (§3.4). Va pegado a la izquierda del slot.
- **Separación:** 6 px; el resto lo absorbe un espaciador flexible con mínimo 0.
- **Cuenta regresiva:** misma altura que la fila. El selector reemplaza la fila y termina con su propia fila de la misma forma.
- **Sin cambios de ancho:** ningún botón cambia de ancho con hover o foco; los atajos van en el tooltip.
- **Presupuesto en el peor caso** (ventana de 300, gutter de 17 px): tarjeta de 267 px, interior de 241 px. La fila ocupa 80 + 6 + 32 + 6 + 108 = 232 px. Con Programar con texto (tarjeta ≥ 340, interior ≥ 314) ocupa 282 px.

**Problema que se corrigió.** La barra de scroll tapaba los botones de la derecha. En WebView2 (Chromium en Windows) las barras son clásicas, de 15–17 px, y ocupan espacio dentro del contenedor. Sin reservarlo, el contenido calculado para el ancho total quedaba debajo de la barra y Enviar se cortaba.

**Solución**
1. **Un solo contenedor con scroll por columna:** la lista, el detalle, la columna lateral y la hoja de ajustes. Nada más scrollea, salvo el borrador cuando llega a su tope.
2. **Gutter reservado** con `scrollbar-gutter: stable` en cada contenedor con scroll (y en el borrador). El espacio de la barra existe siempre, haya scroll o no. El contenido no salta cuando aparece la barra y nunca queda debajo de ella.
3. **Padding derecho:** 8 px después del gutter en la lista y 12 px en el detalle. Así Enviar queda al menos a 8 px de la barra. Los presupuestos de §3.4 y de este apartado ya descuentan 17 px de gutter.
4. **Barras finas con el tema:** `scrollbar-width: thin` y `scrollbar-color: var(--sb-thumb) transparent` (dentro de `@supports`). Como respaldo para WebView2 anteriores a Chromium 121 se usa `::-webkit-scrollbar`: 10 px de ancho, thumb de 6 px con borde transparente y hover en `--accent`.
   - El thumb contrasta ≥ 3:1 con el fondo: `#6E8576` sobre blanco 4:1, sobre `--bg` 3,5:1; en oscuro `#6C8274` sobre `--surface` 4:1.
   - En Windows, "thin" sigue siendo una barra que se puede agarrar (unos 11 px).
5. **Sin scroll anidado que trabe la rueda:**
   - El borrador crece con el contenido (auto-alto) hasta su tope: 3, 5 o 12 líneas según el alto; en el detalle, `min(320px, 45% del alto)`.
   - Solo al llegar al tope scrollea él, con `overscroll-behavior: contain`, para que la rueda no arrastre la lista cuando el borrador llega a su final.
   - Mientras no llega al tope no tiene scroll propio, así que la rueda mueve la lista.
6. **Acciones fijas en el detalle (≥ 600 px):** la fila de acciones (o la cuenta regresiva) del panel de detalle es `position: sticky; bottom: 0`, con fondo `--surface` y una línea superior. Queda visible aunque el borrador o el último mensaje sean largos.
7. **Toast fuera del detalle:** en lista + detalle, el toast va abajo a la izquierda, sobre la lista (264–284 px), y nunca tapa las acciones fijas del detalle. En una columna, la lista reserva 56 px abajo (`padding-bottom` y `scroll-padding-bottom`).
8. **Foco con teclado:** al mover el foco a una tarjeta se usa `focus({preventScroll: true})` y después `scrollIntoView({ block: 'nearest' })`. Con `scroll-margin` en la tarjeta (8 px arriba, 56 px abajo) y `scroll-padding` en la columna, la tarjeta queda entera, con sus botones, sin quedar bajo el toast. El gutter estable evita cualquier desplazamiento horizontal.

### 5.7 Lista de pendientes
| Estado | Qué se ve |
|--------|-----------|
| Cargando | 3 esqueletos; a los 3 s, "Abriendo la base…". |
| Vacía | "Nada por aprobar." con la última vuelta y la próxima del agente, más enlaces a Programados y Fallidos. |
| Filtro sin resultados | "No hay tareas pendientes." + "Ver todas". |
| Error de base | Ver §5.2. |
| Con contenido | Hasta 30 tarjetas. El scroll se conserva entre sondeos. Si llegan nuevas mientras el usuario está abajo, aparece la píldora "2 nuevas ↑". |

### 5.8 Selector de programación
- Atajos que hacen salto de línea si no entran: "En 1 h", "Hoy 18:00", "Mañana 09:00" y "Lunes 09:00" (este último de viernes a domingo).
- Fecha y Hora nativas. Cada campo tiene un mínimo de 120 px; si no entran juntos, pasan a dos líneas.
- Resumen: "Sale mar 20 oct, 09:00".
- Aviso: "Si la PC está apagada a esa hora, el envío vence a los 30 min y pasa a Fallidos."
- Fila: Volver a la izquierda y **Programar** en el slot de Enviar. Si la hora ya pasó: "Elige una hora futura" y Programar deshabilitado.

### 5.9 Programados
Chat, texto en 2 líneas, "Sale …" y **Cancelar** a la derecha. Toast: "Programación cancelada. La sugerencia volvió a Pendientes."

### 5.10 Fallidos / vencidos
Fondo `--err-soft`, motivo y **Reintentar** en un slot de 108 px. Reintentar usa la cuenta de 5 s con Deshacer en el mismo lugar.

### 5.11 Toasts
- Uno a la vez, con `role="status"`, durante 5 s.
- El texto usa el participio del botón: Enviado, Programado, Descartada, Copiado #147.

### 5.12 Barra de estado
Muestra "● Agente hace 3 min   ● WhatsApp conectado   Leído 10:42:15". Un clic abre Ajustes.

### 5.13 Modo contador
- Píldora de 184 × 48: cuervo verde, número de pendientes, fallidos en rojo y punto de salud.
- Un clic o `Enter` restaura la ventana.

### 5.14 Ajustes y §5.15 Buscar actualizaciones
- **Ajustes:** ruta de la base (con validación), Iniciar con Windows, tema y versión.
- **Buscar actualizaciones:**
  | Estado | Qué se ve |
  |--------|-----------|
  | Reposo | "Buscar actualizaciones" y la última búsqueda. |
  | Buscando | Botón deshabilitado con "Buscando…". |
  | Al día | "Tienes la última versión (0.3.1)." |
  | Disponible | "Hay una versión nueva: 0.4.0" y "Descargar e instalar". |
  | Descargando | Progreso en % y MB, con Cancelar. |
  | Listo para reiniciar | "Reiniciar ahora", deshabilitado si hay una cuenta de envío en curso. |
  | Error | "No se pudo comprobar…" y Reintentar. |
- La hoja de ajustes tiene un único scroll, con gutter estable.

---

## 6. Enviar sin clics accidentales
1. Un clic en **Enviar** (o `Ctrl+Enter`) todavía no escribe nada. La fila pasa a mostrar "Enviando a Rosa Quispe en 5 s", con una barra que se vacía y **Deshacer** (`Esc`, `Ctrl+Z`) en el rectángulo exacto de Enviar.
2. A los 5 s se ejecuta la transacción. Toast "Enviado a …" ("En cola…" si WhatsApp está caído).
3. Si se cierra o se oculta la ventana durante la cuenta, el envío se cancela.
4. Antes de la transacción se vuelve a comprobar que la sugerencia no esté desactualizada.

Como Deshacer queda donde estaba Enviar, un doble clic cancela en lugar de enviar.

Descarté mantener presionado (lento y malo con teclado y lector de pantalla) y la confirmación inline (dos clics siempre para evitar un error poco frecuente).

---

## 7. Atajos
Los atajos de una letra solo funcionan con el foco fuera de un campo de texto.

| Atajo | Acción |
|-------|--------|
| `↑` `↓` / `K` `J` | Tarjeta anterior / siguiente (la desplaza hasta verla entera) |
| `Enter` / `E` | Abrir la tarjeta o ir al borrador |
| `C` | Copiar el id (`#147`) |
| `Esc` | Salir del borrador, cerrar el selector o los ajustes, deshacer la cuenta |
| `Ctrl+Enter` | Enviar |
| `Ctrl+Shift+Enter` | Enviar igual |
| `Ctrl+Z` | Deshacer envío en cuenta, descarte o programación |
| `P` | Programar |
| `D` / `Supr` | Descartar |
| `Alt+1..3` | Pestañas |
| `Ctrl+0..3` | Contador / Compacto / Normal / Amplio |
| `Ctrl+,` | Ajustes |
| `Ctrl+Alt+W` (global) | Mostrar u ocultar (por confirmar) |

---

## 8. Tokens

### 8.1 Color
**Criterio de la paleta**
- Los fondos son verdes con un tinte leve.
- El verde bosque se reserva para el acento: Enviar, selección, foco, logo y thumb en hover.
- Las categorías usan **otros tonos**, para no competir con el acento: azul para Responder, magenta para Tarea y gris para Esperando.
- Naranja = desactualizada, rojo = error, ámbar = avisos del sistema.

| Token | Claro | Oscuro | Uso |
|-------|-------|--------|-----|
| `--bg` | `#EDF2EE` | `#0F1512` | Fondo |
| `--surface` | `#FFFFFF` | `#17201B` | Tarjetas, paneles |
| `--surface-2` | `#F3F7F4` | `#1F2A24` | Tarea/esperando, editor |
| `--ink` | `#14231A` | `#E4EDE7` | Texto |
| `--muted` | `#4F6156` | `#98AA9F` | Texto secundario, chip de id |
| `--line` | `#D3DED6` | `#2D3B33` | Bordes |
| `--accent` | `#17643F` | `#74D69C` | Enviar, selección, foco |
| `--accent-ink` | `#FFFFFF` | `#0C1A12` | Texto sobre acento |
| `--accent-soft` | `#DDEFE3` | `#1E3A2A` | Selección, id recién reemplazado |
| `--resp` | `#1F5FAF` | `#8DB8FF` | Franja y etiqueta Responder |
| `--task` / `-soft` | `#8A3A87` / `#F7E8F6` | `#E39BE0` / `#3A2139` | Tarea |
| `--wait` / `-soft` | `#5B6470` / `#EDEFF2` | `#A9B1BC` / `#262C33` | Esperando |
| `--warn` / `-soft` | `#8A5300` / `#FFF3DA` | `#F2C46B` / `#3A2F17` | Avisos, "sin ficha" |
| `--stale` / `-soft` | `#A3470A` / `#FFF0E3` | `#FFB27A` / `#3D2616` | Desactualizada |
| `--err` / `-soft` | `#B42318` / `#FDECEA` | `#FF8F84` / `#3F1C1A` | Error, fallidos |
| `--ok` | `#1E7A3C` | `#6FD39A` | Estado sano |
| `--sb-thumb` | `#6E8576` | `#6C8274` | Thumb de la barra de scroll |

**Contrastes** (WCAG 2.x, luminancia relativa, redondeados):
| Par | Claro | Oscuro |
|-----|-------|--------|
| `--ink` / `--surface` | 15,9:1 | 14,6:1 |
| `--muted` / `--surface` | 6,6:1 | 6,8:1 |
| `--muted` / `--bg` | 5,9:1 | 7,1:1 |
| `--accent-ink` / `--accent` | 7,2:1 | 10:1 |
| `--accent` / `--surface` | 7,2:1 | 9,4:1 |
| `--ink` / `--accent-soft` | 13:1 | 11:1 |
| `--resp` / `--surface` | 6,3:1 | 8,1:1 |
| `--task` / `--task-soft` | 5,8:1 | 6,3:1 |
| `--wait` / `--surface` | 6,0:1 | 7,3:1 |
| `--warn` / `--warn-soft` | 5,8:1 | 8,9:1 |
| `--stale` / `--stale-soft` | 5,5:1 | 8,5:1 |
| `--err` / `--err-soft` | 5,8:1 | 6,5:1 |
| `--sb-thumb` / `--surface` (no textual, ≥ 3:1) | 4:1 | 4:1 |

**Distinción entre franjas.** Azul, magenta, gris, naranja y rojo están separados en tono (≥ 60° entre vecinos) y en luminosidad, y cada franja lleva su texto. El verde del acento no se usa en ninguna franja.

### 8.2 Tipografía
- Familia: **Atkinson Hyperlegible Next** (400/500/700), con respaldo en Segoe UI Variable. En la app hay que incluirla en el bundle.
- Las horas, los ids, los contadores y la cuenta regresiva usan cifras tabulares.
- Escala:
  | Uso | Tamaño |
  |-----|--------|
  | Contador | 22 |
  | Título de detalle | 16 |
  | Nombre | 14 |
  | Cuerpo | 13 |
  | Botones | 13 |
  | Nota, hora, id | 12 |

### 8.3 Espaciado, radios y medidas fijas
- **Escala:** 4 px.
- **Tarjeta:** relleno 10/12, con 14 a la izquierda por la franja.
- **Radios:** ventana 8, tarjeta 6, botón y chip 4, banner 0, contador 24.
- **Medidas fijas:**
  | Elemento | Medida |
  |----------|--------|
  | Slot derecho | 108 × 32 (28 con alto bajo) |
  | Icono | 32 (28 con alto bajo) |
  | Chip de id | 24 de alto |
  | Gutter de scroll | lo que dé el sistema (11–17 px); siempre reservado |

---

## 9. Accesibilidad
- **Contraste:** AA según §8.1. Nunca se depende solo del color.
- **Foco:** anillo de 2 px en `--accent` con offset de 2. El elemento enfocado se desplaza hasta verse entero (§5.6, punto 8).
- **Objetivos:** todos de ≥ 24 × 24. Los botones miden 32 (28 con alto bajo) y el chip de id, 24. El thumb del scroll sigue siendo agarrable.
- **Lector de pantalla:**
  - La lista lleva `role="list"`. Cada tarjeta es un `article` con su nombre y una descripción (categoría, estado, id y hora).
  - Las acciones deshabilitadas usan `aria-disabled` y explican el motivo.
  - Una región `polite` anuncia: llegadas, cuenta regresiva, resultados, "Copiado #147" y reemplazos.
- **Movimiento reducido:** sin animaciones.
- **Alto contraste:** las franjas usan `border` y el foco usa `Highlight`.

## 10. Contenido y tono
Español neutro, con tuteo y sin disculpas. Los verbos repiten la acción. Horas en formato 24 h.

## 11. Dudas abiertas para Erick
1. ¿Atajo global `Ctrl+Alt+W`?
2. En Fallidos, ¿se muestran solo los últimos 7 días o se agrega un estado `archived`?
3. ¿El deshacer dura 5 s o 3 s?
