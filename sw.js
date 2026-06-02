// ═══════════════════════════════════════════════════════════════
// SERVICE WORKER — Primera Mano · Sistema Multicapa Cuba-Ready
// ═══════════════════════════════════════════════════════════════
// Estrategia: Stale-While-Revalidate (SWR)
//   → Muestra caché INSTANTÁNEAMENTE
//   → Descarga versión fresca en segundo plano
//   → Actualiza caché para la próxima vez
//   → Notifica a la app si los datos cambiaron
// ═══════════════════════════════════════════════════════════════

const VERSION = 'v5';

// 3 capas de caché separadas
const CACHE_CORE    = 'pm-core-' + VERSION;    // HTML, JS, CSS (lo esencial)
const CACHE_DATA    = 'pm-data-' + VERSION;    // JSON (productos, precios)
const CACHE_MEDIA   = 'pm-media-' + VERSION;   // Imágenes (webp, png, jpg)

const ALL_CACHES = [CACHE_CORE, CACHE_DATA, CACHE_MEDIA];

// Archivos esenciales que se pre-cachean en la instalación
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './products.json'
];

// ── INSTALL ─────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] Instalando ' + VERSION);
  event.waitUntil(
    caches.open(CACHE_CORE).then(function(cache) {
      return cache.addAll(CORE_ASSETS);
    }).then(function() {
      // Activarse inmediatamente sin esperar
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] Activando ' + VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          // Borrar cualquier caché que no sea de esta versión
          return ALL_CACHES.indexOf(key) === -1;
        }).map(function(key) {
          console.log('[SW] Limpiando caché vieja: ' + key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      // Tomar control de TODAS las pestañas/apps abiertas
      return self.clients.claim();
    })
  );
});

// ── CLASIFICADOR DE CACHÉ ───────────────────────────────────
function getCacheName(url) {
  var path = url.pathname.toLowerCase();
  // JSON → capa de datos
  if (path.endsWith('.json')) return CACHE_DATA;
  // Imágenes → capa de media
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)$/.test(path)) return CACHE_MEDIA;
  // Todo lo demás → capa core
  return CACHE_CORE;
}

// ── FETCH: Stale-While-Revalidate ───────────────────────────
self.addEventListener('fetch', function(event) {
  // Solo interceptar GET
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);

  // Ignorar extensiones de Chrome, etc
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  var cacheName = getCacheName(url);

  event.respondWith(
    caches.open(cacheName).then(function(cache) {
      return cache.match(event.request).then(function(cached) {

        // Fetch fresco en segundo plano (NO bloquea la respuesta)
        var fetchPromise = fetch(event.request).then(function(networkResponse) {
          // Solo cachear respuestas exitosas
          if (networkResponse && networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());

            // Si son datos (JSON), notificar a la app que hay actualización
            if (cacheName === CACHE_DATA) {
              self.clients.matchAll().then(function(clients) {
                clients.forEach(function(client) {
                  client.postMessage({
                    type: 'DATA_UPDATED',
                    url: event.request.url
                  });
                });
              });
            }
          }
          return networkResponse;
        }).catch(function(err) {
          // Sin red: devolver caché o error
          console.log('[SW] Red no disponible para: ' + url.pathname);
          return cached;
        });

        // SWR: devolver caché al instante, actualizar en background
        // Si no hay caché, esperar la respuesta de red
        return cached || fetchPromise;
      });
    })
  );
});

// ── MENSAJES DESDE LA APP ───────────────────────────────────
self.addEventListener('message', function(event) {
  // Forzar activación inmediata de un SW nuevo
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Actualización forzada: borrar TODO
  if (event.data === 'FORCE_UPDATE') {
    console.log('[SW] Actualización forzada — borrando todas las cachés');
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        return caches.delete(key);
      }));
    }).then(function() {
      // Notificar a la app que está listo
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'CACHES_CLEARED' });
        });
      });
    });
  }

  // Pre-cachear una lista de URLs (la app le envía las imágenes)
  if (event.data && event.data.type === 'PRECACHE_URLS') {
    var urls = event.data.urls || [];
    console.log('[SW] Pre-cacheando ' + urls.length + ' recursos');
    caches.open(CACHE_MEDIA).then(function(cache) {
      // Cachear una por una para no saturar
      var i = 0;
      function next() {
        if (i >= urls.length) return;
        var url = urls[i++];
        cache.match(url).then(function(existing) {
          if (existing) {
            // Ya está en caché, saltar
            next();
          } else {
            fetch(url).then(function(res) {
              if (res.ok) cache.put(url, res);
              next();
            }).catch(function() { next(); });
          }
        });
      }
      // Lanzar varios en paralelo según la conexión
      var parallel = 3;
      for (var p = 0; p < parallel; p++) next();
    });
  }
});
