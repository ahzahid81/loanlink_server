require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
// const stripe = require('stripe');
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

function verifyJWT(req, res, next) {
    const token = req.cookies?.token;

    if (!token) {
        return res.status(401).json({ message: "Unauthorized: no token" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.user = decoded;
        next();
    } catch (err) {
        console.error("JWT Verify error: ", err);
        return res.status(401).json({ message: "Unauthorized: invalid token" });
    }
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        const userRole = req.user?.role;

        if (!userRole || !allowedRoles.includes(userRole)) {
            return res.status(403).json({ message: "Forbidden: insufficient role" })
        }

        next();
    };
}

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
                    user: { _id: result.insertedId, ...userDoc },
                });
            } catch (err) {
                console.error("Create user error", err);
                res.status(500).json({ message: "Failed to create user" });
            }
        });

        app.post("/jwt", async (req, res) => {
            try {
                const { email, name, photoURL } = req.body;

                if (!email) { return res.status(400).json({ message: "Email is required" }) }

                let user = await userCollection.findOne({ email });

                if (!user) {
                    const newUser = {
                        name: name || "",
                        email,
                        photoURL: photoURL || "",
                        role: "borrower",
                        status: "active",
                        createdAt: new Date(),
                    };

                    const r = await userCollection.insertOne(newUser);
                    user = { _id: r.insertedId, ...newUser };
                }

                if (user.status === "suspended") {
                    return res.status(403).json({ message: "Account suspended" });
                }

                const payload = {
                    id: user._id.toString(),
                    email: user.email,
                    role: user.role
                };

                const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

                // set cookie
                res.cookie("token", token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                });

                return res.json({ success: true, role: user.role });
            } catch (err) {
                console.error("JWT error:", err);
                res.status(500).json({ message: "JWT issue failed" });
            }
        });

        app.post("/logout", (req, res) => {
            res.clearCookie("token", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            });
            return res.json({ suscess: true })
        });

        app.listen(port, () => {
            console.log(`Example app listening on port ${port}`)
        })
    } catch (err) {
        console.error(err);
    }
}

run().catch(console.dir);