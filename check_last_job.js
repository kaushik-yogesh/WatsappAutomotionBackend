const mongoose = require("mongoose");
const SocialPostJob = require("./src/models/SocialPostJob");
require('dotenv').config();

async function checkLastJob() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const jobs = await SocialPostJob.find().sort({ createdAt: -1 }).limit(1);
    if (jobs.length > 0) {
      console.log(JSON.stringify(jobs[0], null, 2));
    } else {
      console.log("No jobs found.");
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkLastJob();
