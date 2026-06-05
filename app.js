// ========================================
// ACTUALIZACIÓN DE LA PWA
// ========================================

// Función global para actualizar la app (llamada por el botón "Actualizar")
window.actualizarApp = function() {
  // Mostrar feedback visual al usuario
  var btns = document.querySelectorAll('[id^="btn-actualizar"]');
  btns.forEach(function(btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Actualizando...';
  });

  // Paso 1: Enviar mensaje al SW para borrar cachés
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage('FORCE_UPDATE');
  }

  // Paso 2: Borrar todas las cachés desde la app también
  if ('caches' in window) {
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(name) {
        console.log('[App] Borrando caché:', name);
        return caches.delete(name);
      }));
    }).then(function() {
      console.log('[App] Todas las cachés borradas');
    });
  }

  // Paso 3: Desregistrar el SW actual y re-registrar uno nuevo
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
      var unregisterPromises = registrations.map(function(reg) {
        return reg.unregister();
      });
      return Promise.all(unregisterPromises);
    }).then(function() {
      console.log('[App] Service Workers desregistrados');
      // Esperar un momento y recargar con caché busteado
      setTimeout(function() {
        // Forzar recarga completa (sin caché del navegador)
        window.location.href = window.location.pathname + '?updated=' + Date.now();
      }, 500);
    }).catch(function() {
      // Si falla, recargar de todas formas
      window.location.href = window.location.pathname + '?updated=' + Date.now();
    });
  } else {
    // Sin soporte de SW, simplemente recargar
    window.location.href = window.location.pathname + '?updated=' + Date.now();
  }
};

// Register Service Worker con manejo de actualizaciones
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').then(function(registration) {
      console.log('[App] ServiceWorker registrado correctamente');

      // Detectar actualizaciones disponibles
      registration.addEventListener('updatefound', function() {
        var newWorker = registration.installing;
        console.log('[App] Nuevo ServiceWorker encontrado, instalando...');

        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // Hay una actualización disponible
              console.log('[App] Actualización disponible — activando...');
              newWorker.postMessage('SKIP_WAITING');
            }
          }
        });
      });

      // Buscar actualización inmediatamente al cargar
      registration.update();

    }).catch(function(err) {
      console.log('[App] Error registrando ServiceWorker:', err);
    });

    // Cuando un nuevo SW toma control, recargar la página (Auto-Update)
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      console.log('[App] Nuevo SW en control — auto-recargando...');
      window.location.href = window.location.pathname + '?updated=' + Date.now();
    });

    // Detectar cuando el usuario vuelve a abrir la app (Visibility API)
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && registration) {
        console.log('[App] App en primer plano, buscando actualizaciones de código...');
        registration.update();
      }
    });

    // Escuchar mensajes del SW
    navigator.serviceWorker.addEventListener('message', function(event) {
      if (event.data === 'CACHES_CLEARED' || (event.data && event.data.type === 'CACHES_CLEARED')) {
        console.log('[App] Cachés borradas por el SW');
      }

      if (event.data && event.data.type === 'DATA_UPDATED') {
        console.log('[App] Datos actualizados en segundo plano. Refrescando UI en vivo...');
        cargarProductosEnVivo();
      }
    });
  });
}

let productsData = { combos: [], electrodomesticos: [], muebles: [] };

function cargarProductosEnVivo() {
  fetch('products.json')
    .then(response => response.json())
    .then(data => {
      productsData = data;
      renderProducts('combos', data.combos);
      renderProducts('electrodomesticos', data.electrodomesticos);
      renderProducts('muebles', data.muebles);
      actualizarCarrito();
      precacheImagesAggressively(data); // Iniciar prefetch de imágenes inteligente
    })
    .catch(error => console.error('Error loading products:', error));
}

document.addEventListener('DOMContentLoaded', () => {
  cargarProductosEnVivo();
});

function precacheImagesAggressively(data) {
  // Solo pre-cachear si el SW está activo
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;

  // Extraer todas las URLs de imágenes de los productos
  let urls = [];
  const categorias = ['combos', 'electrodomesticos', 'muebles'];
  categorias.forEach(cat => {
    if (data[cat]) {
      data[cat].forEach(p => {
        if (p.image) urls.push(p.image);
      });
    }
  });

  if (urls.length > 0) {
    console.log('[App] Solicitando prefetch en segundo plano de ' + urls.length + ' imágenes...');
    navigator.serviceWorker.controller.postMessage({
      type: 'PRECACHE_URLS',
      urls: urls
    });
  }
}

function renderProducts(categoryId, products) {
  // Find the gallery inside the section with id matching category or containing it
  let section = document.getElementById(categoryId) || document.querySelector(`section[id*="${categoryId}"]`);
  if (!section) return;
  const gallery = section.querySelector('.galeria');
  if (!gallery) return;

  gallery.innerHTML = '';
  
  if (products.length === 0) {
    gallery.innerHTML = '<p>No hay productos disponibles en esta categoría.</p>';
    return;
  }

  products.forEach(p => {
    const div = document.createElement('div');
    div.className = p.isAgotado ? 'producto agotado' : 'producto';
    div.innerHTML = `
      <img src="${p.image}" alt="${p.name}" onclick="abrirFoto('${p.image}', '${p.name}', event)">
      <h3>${p.name}</h3>
      <p>${p.description}</p>
      ${p.options && p.options.length > 0 ? 
        `<select class="selector-precio">
          ${p.options.map(opt => `<option value="${opt.value}">${opt.text}</option>`).join('')}
        </select>` 
        : '<p class="precio" style="display:none">0</p>'}
      ${p.isAgotado ? 
        `<button class="boton-agotado" disabled>Agotado</button>` : 
        `<button class="boton-carrito" onclick="agregarAlCarrito(this, '${p.name}')">Añadir al carrito 🛒</button>`}
    `;
    gallery.appendChild(div);
  });
}

// === Cart Logic ===
var carrito = [];
try { carrito = JSON.parse(localStorage.getItem("carrito")) || []; } catch(e) { carrito = []; }

function guardarCarrito() {
  localStorage.setItem("carrito", JSON.stringify(carrito));
}

function agregarAlCarrito(btnElement, nombre) {
  let container = btnElement.closest('.producto');
  let select = container.querySelector('.selector-precio');
  let precio = 0;
  
  if (select) {
    // If there's a select, get the price from the selected option value (assume value is numeric)
    precio = parseFloat(select.value.replace(/[^0-9.-]+/g,"")) || 0;
  }
  
  if (precio === 0) {
    // Try to parse from options text if value was not numeric
    if (select && select.options[select.selectedIndex]) {
        let txt = select.options[select.selectedIndex].text;
        let match = txt.match(/\$\s*(\d+(\.\d+)?)/);
        if (match) precio = parseFloat(match[1]);
    }
  }

  agregarAlCarritoReal(nombre, precio);
}

function agregarAlCarritoReal(nombre, precio) {
  carrito.push({ nombre: nombre, precio: precio });
  guardarCarrito();
  actualizarCarrito();
  
  // Visual feedback
  var toast = document.getElementById('custom-toast');
  if (toast) {
    var toastName = document.getElementById('toast-name');
    if (toastName) toastName.innerText = nombre;
    toast.style.display = 'block';
    toast.style.transform = 'translateX(0)';
    setTimeout(() => {
      toast.style.transform = 'translateX(150%)';
      setTimeout(() => { toast.style.display = 'none'; }, 400);
    }, 2500);
  }
}

function actualizarCarrito() {
  var lista = document.getElementById("lista-carrito");
  var totalSpan = document.getElementById("total");
  if (!lista || !totalSpan) return;

  lista.innerHTML = "";
  var total = 0;

  carrito.forEach((item, index) => {
    var li = document.createElement("li");
    li.innerHTML = `<span>${item.nombre} - $${item.precio.toLocaleString()}</span> <button class="item-remove" onclick="eliminarDelCarrito(${index})">❌</button>`;
    lista.appendChild(li);
    total += item.precio;
  });

  totalSpan.textContent = "Total: $" + total.toLocaleString();

  var badges = document.querySelectorAll('#contador-carrito, #cart-badge, #carrito-count');
  badges.forEach(b => {
    b.textContent = carrito.length;
    if (b.id === 'cart-badge') b.style.display = carrito.length > 0 ? 'flex' : 'none';
  });
}

window.eliminarDelCarrito = function(index) {
  carrito.splice(index, 1);
  guardarCarrito();
  actualizarCarrito();
}

window.vaciarCarrito = function() {
  if (carrito.length > 0 && confirm("¿Estás seguro de vaciar el carrito?")) {
    carrito.length = 0;
    guardarCarrito();
    actualizarCarrito();
  }
}

window.enviarWhatsApp = function() {
  if (carrito.length === 0) {
    alert("Tu carrito está vacío.");
    return;
  }

  var mensaje = "🛒 *Pedido desde el Catálogo Primera Mano:*\n\n";
  var total = 0;
  carrito.forEach(item => {
    mensaje += "• " + item.nombre + " - $" + item.precio.toLocaleString() + "\n";
    total += item.precio;
  });
  mensaje += "\n💰 *Total:* $" + total.toLocaleString() + "\n\n📞 Enviado desde el catálogo web.";

  var numeroWhatsApp = "5354449370";
  var url = "https://wa.me/" + numeroWhatsApp + "?text=" + encodeURIComponent(mensaje);
  window.open(url, "_blank");
}

window.toggleCarritoPanel = function() {
  var contenedor = document.getElementById("carrito-contenedor");
  if (contenedor) contenedor.classList.toggle("abierto");
}

window.toggleCarritoModal = window.toggleCarritoPanel;

// Modal details
window.abrirFoto = function(fullSrc, titulo, evt) {
  if (evt) evt.stopPropagation();
  var modal = document.getElementById('product-detail-modal');
  if (!modal) return;

  document.getElementById('product-detail-img').src = fullSrc;
  document.getElementById('product-detail-title').textContent = titulo;
  
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

window.cerrarDetalle = function() {
  var modal = document.getElementById('product-detail-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

window.filtrarProductos = function() {
  var q = document.getElementById('buscar-producto').value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  document.querySelectorAll('.producto').forEach(function(p) {
    var name = p.querySelector('h3').textContent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    var desc = p.querySelector('p').textContent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    p.style.display = (name.includes(q) || desc.includes(q)) ? '' : 'none';
  });
}

// Manejador global para recargar imagenes fallidas
document.addEventListener('error', function(event) {
  if (event.target && event.target.tagName && event.target.tagName.toLowerCase() === 'img') {
    const img = event.target;
    let attempts = parseInt(img.getAttribute('data-retries') || '0', 10);
    if (attempts < 3) {
      attempts++;
      img.setAttribute('data-retries', attempts);
      img.removeAttribute('loading');
      setTimeout(() => {
        try {
          const url = new URL(img.src, window.location.href);
          url.searchParams.set('retry', Date.now());
          img.src = url.href;
        } catch(e) {}
      }, 1500 * attempts);
    } else {
      img.style.opacity = '0.3';
    }
  }
}, true);

// ========================================
// INSTALADOR PWA CADA 2 MINUTOS
// ========================================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

document.addEventListener('DOMContentLoaded', () => {
  const installModalHtml = `
  <div id="pwa-install-modal" style="display:none; position:fixed; bottom:20px; left:50%; transform:translateX(-50%); width:90%; max-width:400px; background:linear-gradient(135deg, #111, #1a1a1a); border:2px solid #d4af37; border-radius:20px; box-shadow:0 10px 40px rgba(212,175,55,0.3); padding:20px; z-index:12000; color:#fff; font-family:sans-serif; text-align:center; animation: popIn 0.5s ease-out;">
    <style>@keyframes popIn { from { opacity: 0; transform: translate(-50%, 20px); } to { opacity: 1; transform: translate(-50%, 0); } }</style>
    <button onclick="document.getElementById('pwa-install-modal').style.display='none'" style="position:absolute; top:10px; right:15px; background:transparent; border:none; color:#888; font-size:1.5rem; cursor:pointer;">✕</button>
    <div style="width:60px; height:60px; border-radius:15px; background:linear-gradient(135deg, #d4af37, #b8921b); display:flex; justify-content:center; align-items:center; margin:0 auto 15px;">
      <i class="fa-solid fa-gem" style="font-size:2rem; color:#000;"></i>
    </div>
    <h3 style="margin:0 0 10px 0; color:#d4af37; font-size:1.4rem; text-transform:uppercase;">¡Instala nuestra App!</h3>
    <p style="margin:0 0 20px 0; font-size:0.95rem; color:#ccc;">Instala Primera Mano en tu pantalla de inicio para una experiencia más rápida.</p>
    <button id="btn-install-pwa" style="width:100%; padding:15px; border-radius:12px; border:none; background:linear-gradient(135deg, #d4af37, #b8921b); color:#000; font-size:1.1rem; font-weight:bold; cursor:pointer; box-shadow:0 4px 15px rgba(212,175,55,0.4);">INSTALAR AHORA</button>
  </div>
  `;
  document.body.insertAdjacentHTML('beforeend', installModalHtml);

  document.getElementById('btn-install-pwa').addEventListener('click', async () => {
    if (deferredPrompt) {
      document.getElementById('pwa-install-modal').style.display = 'none';
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredPrompt = null;
      }
    } else {
      alert("Para instalar, por favor abre el menú de tu navegador (los 3 puntitos arriba a la derecha) y selecciona 'Instalar aplicación' o 'Añadir a la pantalla principal'.");
      document.getElementById('pwa-install-modal').style.display = 'none';
    }
  });

  function showInstallPrompt() {
    // Solo mostrar si NO está en la APK instalada
    if (!window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone) {
      document.getElementById('pwa-install-modal').style.display = 'block';
    }
  }

  // Mostrar por primera vez a los 3 segundos
  setTimeout(showInstallPrompt, 3000);

  // Luego mostrar cada 2 minutos
  setInterval(showInstallPrompt, 120000);
});
