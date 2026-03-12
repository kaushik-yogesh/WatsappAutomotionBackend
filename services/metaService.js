import fetch from "node-fetch"

export const getWhatsAppData = async (token) => {

    const headers = {
        Authorization: `Bearer ${token}`
    }

    // Step 1 get businesses
    const businessRes = await fetch(
        "https://graph.facebook.com/v19.0/me/businesses",
        { headers }
    )

    const businessData = await businessRes.json()

    const businessId = businessData.data[0].id

    // Step 2 get WABA
    const wabaRes = await fetch(
        `https://graph.facebook.com/v19.0/${businessId}/owned_whatsapp_business_accounts`,
        { headers }
    )

    const wabaData = await wabaRes.json()

    const wabaId = wabaData.data[0].id

    // Step 3 get phone number
    const phoneRes = await fetch(
        `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers`,
        { headers }
    )

    const phoneData = await phoneRes.json()

    const phoneNumberId = phoneData.data[0].id

    return {
        businessId,
        wabaId,
        phoneNumberId
    }

}