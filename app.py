from flask import Flask, request, jsonify, g
import sqlite3
import os
import json

app = Flask(__name__)
DATABASE = 'users.db'
SPEC_FILE = 'spec.json'

# Database helper functions
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db:
        db.close()

def init_db():
    if not os.path.exists(DATABASE):
        db = get_db()
        db.execute('''
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE
            )
        ''')
        db.commit()

# CRUD Routes
@app.route('/users', methods=['GET'])
def get_users():
    users = get_db().execute('SELECT * FROM users').fetchall()
    return jsonify([dict(user) for user in users]), 200

@app.route('/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    user = get_db().execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    if user:
        return jsonify(dict(user)), 200
    return jsonify({'error': 'User not found'}), 404

@app.route('/users', methods=['POST'])
def create_user():
    data = request.get_json()
    try:
        db = get_db()
        cursor = db.execute('INSERT INTO users (name, email) VALUES (?, ?)',
                            (data['name'], data['email']))
        db.commit()
        return jsonify({'id': cursor.lastrowid}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email must be unique'}), 400

@app.route('/users/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    data = request.get_json()
    db = get_db()
    cursor = db.execute('UPDATE users SET name = ?, email = ? WHERE id = ?',
                        (data['name'], data['email'], user_id))
    db.commit()
    if cursor.rowcount:
        return jsonify({'message': 'User updated'}), 200
    return jsonify({'error': 'User not found'}), 404

@app.route('/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    db = get_db()
    cursor = db.execute('DELETE FROM users WHERE id = ?', (user_id,))
    db.commit()
    if cursor.rowcount:
        return jsonify({'message': 'User deleted'}), 200
    return jsonify({'error': 'User not found'}), 404

# OpenAPI 3.0 Spec endpoint (loaded from file)
@app.route('/openapi.json', methods=['GET'])
def openapi_spec():
    try:
        with open(SPEC_FILE, 'r') as f:
            spec = json.load(f)
        return jsonify(spec), 200
    except FileNotFoundError:
        return jsonify({'error': 'OpenAPI spec not found'}), 404

# Run the app
if __name__ == '__main__':
    init_db()
    app.run(debug=True)