require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jsonwebtoken = require('jsonwebtoken');
const stripe = require('stripe');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;


//Middlewares
app.use(cors({
    origin: process.env.CLIENT_ORIGIN,
    credentials: true,
}));
app.use(express.json())
app.use(cookieParser());


const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        await client.connect();
        console.log("MongoDB connected")

        const db = client.db(process.env.DB_NAME);
        const userCollection = db.collection("users");

        app.get('/', (req, res) => {
            res.send('LoanLink API running with MongoDB')
        })

        app.post("/users", async (req, res) => {
            try {
                const { name, email, photoURL, role, status } = req.body;

                if (!email) {
                    return res.status(400).json({ message: "Email is required" });
                }

                const existing = await userCollection.findOne({ email });

                if (existing) {
                    return res.status(200).json({
                        message: "User already exists", user: existing,
                    });
                }

                const userDoc = {
                    name: name || "",
                    email,
                    photoURL: photoURL || "",
                    role: role || "borrower",
                    status: status || "active",
                    createdAt: new Date(),
                };

                const result = await userCollection.insertOne(userDoc);

                return res.status(201).json({
                    message: "User created successfully",
                    user: {_id: result.insertedId, ...userDoc},
                });
            }catch(err){
                console.error("Create user error", err);
                res.status(500).json({message: "Failed to create user"});
            }
        });

        app.post("/logout", (req, res) => {
            return res.json({suscess: true})
        })

        app.listen(port, () => {
            console.log(`Example app listening on port ${port}`)
        })
    } catch (err) {
        console.error(err);
    }
}

run().catch(console.dir);