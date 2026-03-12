import express from "express"
import cors from "cors"
import whatsappRoutes from "./routes/whatsapp.js"

const app = express()

app.use(cors())
app.use(express.json())

app.use("/api", whatsappRoutes)

app.listen(5000, () => {
    console.log("Server running on 5000")
})