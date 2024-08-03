import axios from "axios";
import { pick, mapKeys, merge } from "lodash";
import { MongoClient, ObjectId } from "mongodb";
import nodemailer from "nodemailer";
import { parse } from "json2csv";

const MONGODB_URI = process.env.MONGODB_URI;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function processCSV(data, userEmail, existingTaskId = null) {
  const processedData = [];
  const apolloKeys = process.env.APOLLO_APIS.split(",");
  const numApiKeys = apolloKeys.length;

  if (numApiKeys < 1) {
    throw new Error("Don't have API Keys Setup");
  }

  // Use existing taskId if provided, otherwise create a new one
  const taskId = existingTaskId
    ? ObjectId.createFromHexString(existingTaskId)
    : new ObjectId();

  // Initialize rate limiting counters for each key
  const keyUsage = apolloKeys.map(() => ({
    minuteCount: 0,
    hourCount: 0,
    dayCount: 0,
    lastMinuteReset: Date.now(),
    lastHourReset: Date.now(),
    lastDayReset: Date.now()
  }));

  let currentKeyIndex = 0;

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db("linkedin_to_email");
  const collection = db.collection("linkedin_to_email_data");

  const existingTask = await collection.findOne({ taskId });

  if (!existingTask) {
    await collection.insertOne({ taskId, userEmail, data: [] });
  }

  for (const [index, row] of data.entries()) {
    try {
      if (row["linkedin"]) {
        let success = false;
        let retries = 0;

        while (retries < numApiKeys && !success) {
          try {
            // Check and update rate limits
            await checkAndUpdateRateLimits(
              keyUsage[currentKeyIndex],
              currentKeyIndex
            );

            console.log(
              `For index:: ${index} :: ${apolloKeys[currentKeyIndex]}`
            );
            const response = await axios.post(
              "https://api.apollo.io/v1/people/match",
              { linkedin_url: row["linkedin"] },
              {
                headers: {
                  "X-Api-Key": apolloKeys[currentKeyIndex]
                }
              }
            );

            const result = pick(
              response?.data?.person,
              "first_name",
              "last_name",
              "name",
              "email",
              "linkedin_url",
              "title",
              "photo_url",
              "email_status",
              "headline",
              "city",
              "state",
              "country",
              "is_likely_to_engage",
              "seniority",
              "organization.name",
              "organization.website_url",
              "organization.linkedin_url",
              "organization.estimated_num_employees",
              "organization.industry",
              "organization.short_description",
              "organization.seo_description",
              "organization.total_funding_printed"
            );
            const { organization, ...restOfResult } = result;
            const renamedOrganization = mapKeys(organization, (value, key) =>
              key === "name" ? "organization_name" : key
            );
            const flattenedResult = merge(
              {},
              restOfResult,
              renamedOrganization
            );

            const processedRow = { ...row, ...flattenedResult };
            processedData.push(processedRow);

            // Save each processed row to the database
            const updateResult = await collection.updateOne(
              { taskId, "data.linkedin": row["linkedin"] },
              { $set: { userEmail, "data.$": processedRow } },
              { upsert: true }
            );

            if (updateResult.matchedCount === 0) {
              // If no document was matched, it means we need to push a new element
              await collection.updateOne(
                { taskId },
                {
                  $push: { data: processedRow },
                  $set: { userEmail }
                },
                { upsert: true }
              );
            }

            success = true;
            keyUsage[currentKeyIndex].minuteCount++;
            keyUsage[currentKeyIndex].hourCount++;
            keyUsage[currentKeyIndex].dayCount++;

            // Cycle to the next API key
            currentKeyIndex = (currentKeyIndex + 1) % numApiKeys;
          } catch (error) {
            if (
              error.response &&
              (error.response.status === 422 || error.response.status === 429)
            ) {
              console.log(
                `API key ${currentKeyIndex} failed. Trying next key.`
              );
              currentKeyIndex = (currentKeyIndex + 1) % numApiKeys;
              retries++;
              console.log("Waiting 5 seconds, previous key got banned...");
              await sleep(5000);
            } else {
              throw error;
            }
          }
        }

        if (!success) {
          console.log(
            `Failed to process row ${index} after trying all API keys`
          );
          const errorRow = {
            ...row,
            result: "Error, unable to find contact after trying all API keys"
          };
          processedData.push(errorRow);
          await collection.updateOne(
            { taskId, "data.linkedin": row["linkedin"] },
            { $set: { userEmail, "data.$": errorRow } },
            { upsert: true }
          );
        }
      } else {
        const errorRow = { ...row, result: "Error, unable to find contact" };
        processedData.push(errorRow);
        await collection.updateOne(
          { taskId, "data.linkedin": row["linkedin"] },
          { $set: { userEmail, "data.$": errorRow } },
          { upsert: true }
        );
      }
    } catch (error) {
      console.error(
        "Error calling Apollo API:",
        error.response?.data || error.message
      );
      const errorRow = { ...row, result: "Error processing row" };
      processedData.push(errorRow);
      await collection.updateOne(
        { taskId, "data.linkedin": row["linkedin"] },
        { $set: { userEmail, "data.$": errorRow } },
        { upsert: true }
      );
    }
  }

  // Generate and send CSV
  await generateAndSendCSV(processedData, userEmail);

  await client.close();
  return { taskId };
}

async function generateAndSendCSV(processedData, userEmail) {
  const fields = Object.keys(processedData[0]);
  const csv = parse(processedData, { fields });

  console.log({ csv });
  console.log("CSV generated. Length:", csv.length);
  console.log("CSV sample:", csv.slice(0, 200) + "...");

  // Send email
  let transporter = nodemailer.createTransport({
    host: `smtp.mailazy.com`,
    port: `587`,
    auth: {
      user: `cbutp5enaoi4u6bg395gPeBOdCdanA`,
      pass: `${process.env.MAILZY_SEC}`
    }
  });

  let mailOptions = {
    from: `"Team Inbox Pirates" noreply@mail.inboxpirates.com`,
    to: userEmail,
    subject: "[Inboxpirates] Linkedin To Email Results",
    text: "Your Linkedin To Email results are ready. Please check the attached file below! Make sure you save it as a .csv file",
    html: "<b>Ola! Your Linkedin To Email results are ready. Please check the attached file below! Make sure you save it as a .csv file😊</b>",
    attachments: [
      {
        filename: "results.txt",
        content: csv.toString()
      }
    ]
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
    console.log("Message ID:", info.messageId);
    console.log("Email preview URL:", nodemailer.getTestMessageUrl(info));
  } catch (err) {
    console.error("Error sending email:", err);
  }
}

async function checkAndUpdateRateLimits(keyUsage, keyIndex) {
  const now = Date.now();

  // Reset counters if necessary
  if (now - keyUsage.lastMinuteReset >= 60000) {
    keyUsage.minuteCount = 0;
    keyUsage.lastMinuteReset = now;
  }
  if (now - keyUsage.lastHourReset >= 3600000) {
    keyUsage.hourCount = 0;
    keyUsage.lastHourReset = now;
  }
  if (now - keyUsage.lastDayReset >= 86400000) {
    keyUsage.dayCount = 0;
    keyUsage.lastDayReset = now;
  }

  // Check if we've hit any limits
  if (
    keyUsage.minuteCount >= 50 ||
    keyUsage.hourCount >= 200 ||
    keyUsage.dayCount >= 600
  ) {
    console.log(`Rate limit reached for key ${keyIndex}. Waiting 1 minute...`);
    await sleep(60000); // Wait for 1 minute
    return checkAndUpdateRateLimits(keyUsage, keyIndex); // Recursive call to check again
  }

  // If we haven't hit any limits, add a small delay to be safe
  console.log("Waiting five seconds...");
  await sleep(5000); // 3 seconds between calls
}

// Function to resume a task
export async function resumeTask(taskId) {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db("linkedin_to_email");
  const collection = db.collection("linkedin_to_email_data");

  const task = await collection.findOne({
    taskId: ObjectId.createFromHexString(taskId)
  });
  if (!task) {
    throw new Error("Task not found");
  }

  const processedData = task.data;
  const userEmail = task.userEmail;

  // Continue processing from where we left off
  const remainingData = processedData.filter(
    (row) => !row.result || row.result.startsWith("Error")
  );

  // Pass the existing taskId to processCSV
  const result = await processCSV(remainingData, userEmail, taskId);

  await client.close();
  return result;
}
