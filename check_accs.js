const mongoose = require("mongoose");
const InstagramAccount = require("./src/models/InstagramAccount");
require('dotenv').config();

async function checkAccs() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const accs = await InstagramAccount.find({ user: "69e278d85a360de80b94bf9c" });
    console.log(JSON.stringify(accs, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkAccs();
