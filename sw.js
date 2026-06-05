// ═══════════════════════════════════════════════════════════════
// SERVICE WORKER — Primera Mano · Auto-Update Inteligente
// ═══════════════════════════════════════════════════════════════
// Estrategia:
//   HTML/JS/CSS/JSON → NETWORK-FIRST (siempre busca lo nuevo)
//   Imágenes         → CACHE-FIRST  (rápido, se actualiza en background)
//
// Al usar Network-First, la PWA siempre descargará la última
// versión del catálogo directamente desde GitHub Pages.
// ═══════════════════════════════════════════════════════════════

const VERSION = 'v6-network-first';

// 2 capas de caché
const CACHE_APP   = 'pm-app-' + VERSION;    // HTML, JS, CSS, JSON
const CACHE_MEDIA = 'pm-media-' + VERSION;   // Imágenes

const ALL_CACHES = [CACHE_APP, CACHE_MEDIA];

// ── INSTALL ─────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] Instalando ' + VERSION);
  // Activarse INMEDIATAMENTE sin esperar (reemplaza al SW viejo)
  event.waitUntil(self.skipWaiting());
});

// ── ACTIVATE ────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] Activando ' + VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          // Borrar CUALQUIER caché que no sea de esta versión
          return ALL_CACHES.indexOf(key) === -1;
        }).map(function(key) {
          console.log('[SW] Limpiando caché vieja: ' + key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      // Tomar control de TODAS las pestañas abiertas inmediatamente
      return self.clients.claim();
    }).then(function() {
      // Notificar a la app que hay una versión nueva
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SW_UPDATED', version: VERSION });
        });
      });
    })
  );
});

// ── CLASIFICADOR ────────────────────────────────────────────
function isImage(url) {
  return /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)(\?.*)?$/i.test(url.pathname);
}

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  // Solo interceptar GET
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);

  // Ignorar extensiones de Chrome, etc
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isImage(url)) {
    // ═══ IMÁGENES: Cache-First (rápido) + actualizar en background ═══
    event.respondWith(
      caches.open(CACHE_MEDIA).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          var fetchPromise = fetch(event.request).then(function(response) {
            if (response && response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(function() {
            return cached;
          });

          return cached || fetchPromise;
        });
      })
    );
  } else {
    // ═══ HTML/JS/CSS/JSON: Network-First (siempre fresco) ═══
    event.respondWith(
      fetch(event.request).then(function(response) {
        // Guardar en caché para uso offline
        if (response && response.ok) {
          var responseClone = response.clone();
          caches.open(CACHE_APP).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(function() {
        // Sin red: servir desde caché (modo offline)
        return caches.open(CACHE_APP).then(function(cache) {
          return cache.match(event.request).then(function(cached) {
            return cached || new Response('Sin conexión', {
              status: 503,
              statusText: 'Offline'
            });
          });
        });
      })
    );
  }
});

// ── MENSAJES DESDE LA APP ───────────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data === 'FORCE_UPDATE') {
    console.log('[SW] Actualización forzada — borrando todas las cachés');
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        return caches.delete(key);
      }));
    }).then(function() {
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'CACHES_CLEARED' });
        });
      });
    });
  }

  // Pre-cachear imágenes
  if (event.data && event.data.type === 'PRECACHE_URLS') {
    var urls = event.data.urls || [];
    console.log('[SW] Pre-cacheando ' + urls.length + ' imágenes');
    caches.open(CACHE_MEDIA).then(function(cache) {
      var i = 0;
      function next() {
        if (i >= urls.length) return;
        var url = urls[i++];
        cache.match(url).then(function(existing) {
          if (existing) {
            next();
          } else {
            fetch(url).then(function(res) {
              if (res.ok) cache.put(url, res);
              next();
            }).catch(function() { next(); });
          }
        });
      }
      for (var p = 0; p < 3; p++) next();
    });
  }
});
