import axios from "axios";
import { pick, mapKeys, merge } from "lodash";
import { MongoClient } from "mongodb";
import nodemailer from "nodemailer";
import { parse } from "json2csv";

const MONGODB_URI = process.env.MONGODB_URI;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function processCSV(data, userEmail) {
  const processedData = [];
  console.log(process.env.APOLLO_APIS);
  const apolloKeys = process.env.APOLLO_APIS;
  const apolloAPIKeys = apolloKeys.split(",");
  const numApiKeys = apolloAPIKeys?.length ?? 0;
  console.log("length", numApiKeys);
  if (numApiKeys < 1) {
    throw new Error("Don't have API Keys Setup");
  }

  let currentKeyIndex = 0;
  let callCount = 0;
  let lastCallTime = Date.now();

  for await (const [index, row] of data.entries()) {
    try {
      if (row["linkedin"]) {
        let retries = 0;
        let success = false;

        while (retries < numApiKeys && !success) {
          try {
            // Implement rate limiting
            const currentTime = Date.now();
            const timeSinceLastCall = currentTime - lastCallTime;
            if (timeSinceLastCall < 1200) {
              // 50 calls per minute = 1 call per 1.2 seconds
              await sleep(1200 - timeSinceLastCall);
            }

            console.log(
              `For index:: ${index} :: ${apolloAPIKeys[currentKeyIndex]}`
            );
            const response = await axios.post(
              "https://api.apollo.io/v1/people/match",
              { linkedin_url: row["linkedin"] },
              {
                headers: {
                  "X-Api-Key": apolloAPIKeys[currentKeyIndex]
                }
              }
            );

            const result = pick(
              response?.data?.person,
              "first_name",
              "last_name",
              "name",
              "email",
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
              "organization.total_funding_printed"
            );
            // Flatten the organization object and rename the 'name' field
            const { organization, ...restOfResult } = result;
            const renamedOrganization = mapKeys(organization, (value, key) =>
              key === "name" ? "organization_name" : key
            );
            const flattenedResult = merge(
              {},
              restOfResult,
              renamedOrganization
            );
            console.log(`${JSON.stringify(flattenedResult)}`);
            processedData.push({ ...row, ...flattenedResult });
            success = true;
            lastCallTime = Date.now();
            callCount++;

            // Reset key if daily limit is reached
            if (callCount >= 600) {
              currentKeyIndex = (currentKeyIndex + 1) % numApiKeys;
              callCount = 0;
            }
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
              await sleep(1000); // Wait 1 second before trying the next key
            } else {
              throw error;
            }
          }
        }

        if (!success) {
          console.log(
            `Failed to process row ${index} after trying all API keys`
          );
          processedData.push({
            ...row,
            result: "Error, unable to find contact after trying all API keys"
          });
        }
      } else {
        processedData.push({ ...row, result: "Error, unable to find contact" });
      }
    } catch (error) {
      console.error(
        "Error calling Apollo API:",
        error.response?.data || error.message
      );
      processedData.push({ ...row, result: "Error processing row" });
    }
  }

  // Store results in MongoDB and send email
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db("linkedin_to_email");
    const collection = db.collection("linkedin_to_email_data");
    await collection.insertOne({ userEmail, data: processedData });
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

    await client.close();
  } catch (error) {
    console.error("Error storing results or sending email:", error);
  }

  return processedData;
}
