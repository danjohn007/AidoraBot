# Aidora Bot · CRM Send

Se conserva `whatsappWebhookAidoraBot`, que responde `Hola` a mensajes de texto, y se agrega `crmSendAidora` para que la web pueda enviar la plantilla aprobada.

Plantilla:
- Nombre: `aidora_plantilla`
- Idioma: `es_MX`
- Variable: `{{1}}`

Secrets requeridos:
- `VERIFY_TOKEN_AIDORABOT`
- `WHATSAPP_TOKEN_AIDORABOT`
- `WHATSAPP_PHONE_NUMBER_ID_AIDORABOT`
- `WEB_ADMIN_KEY_AIDORABOT`

El valor de `WEB_ADMIN_KEY_AIDORABOT` debe coincidir con `firebase_admin_key` de la web.
