require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jsonwebtoken = require('jsonwebtoken');
const mongoose = require('mongoose');
const stripe = require('stripe');
const cookieParser = require('cookie-parser');

const app = express();
const port = process.env.PORT || 5000;


//Middlewares
app.use(cors());
app.use(express.json())
app.use(cookieParser());

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})


// "cookie-parser": "^1.4.7",
//     "cors": "^2.8.5",
//     "dotenv": "^17.2.3",
//     "express": "^5.2.1",
//     "jsonwebtoken": "^9.0.3",
//     "mongoose": "^9.0.1",
//     "stripe": "^20.0.0"