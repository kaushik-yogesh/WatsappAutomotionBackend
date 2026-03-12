import express from "express"
import { getWhatsAppData } from "../services/metaService.js"

const whatsappRoutes = express.Router()

whatsappRoutes.post("/connect", async (req, res) => {

    const { token } = req.body

    try {

        const data = await getWhatsAppData(token)

        res.json({
            success: true,
            data
        })

    } catch (err) {

        res.status(500).json({
            error: err.message
        })

    }

})

export default whatsappRoutes