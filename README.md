# Flask User CRUD API

A minimal Flask-based REST API for performing **CRUD operations** on a `User` entity using **SQLite3** as the database.

This project is ideal for:
- Learning REST API basics
- Practicing Postman (unit, integration, load testing)
- Understanding OpenAPI 3 documentation
- Local development with minimal setup

---

## 🛠 Features

- Flask-based REST API (single Python file)
- SQLite3 as persistent storage
- OpenAPI 3.0 spec served at `/openapi.json`
- Postman collection and environment included
- Supports `GET`, `POST`, `PUT`, `DELETE` for `/users`
- Suitable for testing with tools like Postman and Newman

---

## 📦 Project Structure
.
├── app.py # Flask API
├── requirements.txt # Dependencies
├── README.md # Project documentation
├── UserAPI.postman_collection.json # Postman Collection
└── UserAPI.postman_environment.json # Postman Environment