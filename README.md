# Generador de Exámenes IA (DeepSeek)

Esta es una aplicación interactiva que permite generar exámenes de opción múltiple utilizando la inteligencia artificial de DeepSeek. Puedes ingresar un tema libremente o subir tus propios archivos (PDF, TXT, MD, CSV, JSON) para que la IA elabore las preguntas basándose en tu propio material de estudio.

## Características

- **Diseño pizarra y tiza**: Una hermosa interfaz oscura que simula un pizarrón de tiza escolar, con animaciones y microinteracciones de estilo analógico.
- **Integración con DeepSeek**: Utiliza el potente y rápido modelo `deepseek-chat` para redactar preguntas coherentes y explicaciones didácticas.
- **Soporte para múltiples archivos**: Sube archivos PDF, de texto o tablas estructuradas. Los archivos PDF se procesan en el cliente para extraer su contenido de texto.
- **Temporizador personalizable**: Configura el límite de tiempo que prefieras. La interfaz cuenta con alertas visuales de tiempo bajo.
- **Persistencia con LocalStorage**: El historial de exámenes realizados y los grupos creados no se pierden al recargar la página; se guardan en el almacenamiento local del navegador.
- **Organización por Grupos**: Crea grupos temáticos (ej. "Matemáticas", "Historia", "Repaso final") para categorizar y filtrar tus exámenes en el panel de inicio.

---

## Requisitos Previos

Asegúrate de tener instalado **Node.js** (versión 18 o superior). Puedes verificarlo ejecutando en tu terminal:
```bash
node -v
```

---

## Instalación y Configuración

1. **Instalar dependencias**:
   Abre una terminal o consola dentro del directorio de este proyecto (`App Yanette Test`) y ejecuta:
   ```bash
   npm install
   ```

2. **Configurar la Clave API de DeepSeek**:
   El proyecto ya incluye un archivo `.env` con tu clave de API configurada:
   ```env
   DEEPSEEK_API_KEY=tu_clave_api_aqui
   PORT=3000
   ```
   *Nota: También puedes ingresar o cambiar la clave API directamente en la pantalla de configuración de la interfaz web.*

---

## Cómo Ejecutar el Proyecto

1. **Iniciar el servidor local**:
   Ejecuta el siguiente comando en tu terminal para iniciar el proxy y servidor web local:
   ```bash
   npm run dev
   ```

2. **Abrir en el navegador**:
   Abre tu navegador de preferencia e ingresa a:
   [http://localhost:3000](http://localhost:3000)

¡Listo! Ya puedes empezar a crear grupos y generar exámenes personalizados.
