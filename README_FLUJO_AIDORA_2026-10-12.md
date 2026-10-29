# AidoraBot · Flujo completo Aidor(a)

El bot implementa:

1. Bienvenida y menú principal.
2. Información de qué significa ser Aidor(a).
3. Selección de perfil: Básico, Enfermero, Especialista o No estoy seguro(a).
4. Captura de datos personales.
5. Formación y experiencia.
6. Actividades con experiencia.
7. Disponibilidad y días.
8. Movilidad y distancia cuando corresponde.
9. Motivación.
10. Registro final y consulta de estado.
11. Solicitud para hablar con un asesor.

El WhatsApp se obtiene automáticamente del número remitente de Meta. No se vuelve a pedir al usuario.

Persistencia: el bot usa la API web `/aidora/bot-api.php`, protegida con `WEB_ADMIN_KEY_AIDORABOT`, para guardar sesiones, contactos, conversaciones y registros en MySQL.
