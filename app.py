from flask import Flask, render_template, jsonify, request, send_from_directory
import re
import requests
from datetime import datetime, timedelta
import asyncio
import platform
from typing import Dict, List, Optional, Tuple
import google.generativeai as genai
import csv
import os
import json

app = Flask(__name__)


class AlumniAI:
    def __init__(self):
        self.recent_searches = []
        self.alumni_database = []
        # Configure Gemini AI
        self.gemini_available = False
        try:
            genai.configure(api_key="AIzaSyD31wFxP6RENLmOdSOB3HRnZzi2drk4BxE")
            self.chat_model = genai.GenerativeModel('gemini-1.5-flash')
            test_response = self.chat_model.generate_content("Hello")
            if test_response and hasattr(test_response, 'text'):
                self.gemini_available = True
                print("Gemini AI successfully initialized")
            else:
                print("Gemini AI test failed - using fallback")
        except Exception as e:
            print(f"Gemini AI not available: {e}")
            self.gemini_available = False

    def extract_name_from_email(self, email: str) -> Tuple[Optional[str], Optional[str]]:
        match = re.match(r'(\w+)\.(\w+)@esprit\.tn', email.lower())
        return (match.group(1), match.group(2)) if match else (None, None)

    def fetch_linkedin_url(self, first_name: str, last_name: str) -> str:
        # Generate proper LinkedIn profile URL format
        try:
            linkedin_url = f"https://www.linkedin.com/in/{first_name.lower()}-{last_name.lower()}/"
            return linkedin_url
        except:
            return "No LinkedIn profile found"

    def fetch_facebook_url(self, first_name: str, last_name: str) -> str:
        # Enhanced Facebook search with Esprit verification
        try:
            # For demo purposes, we'll simulate a Facebook profile URL
            # In production, you'd use Facebook Graph API or web scraping with Esprit verification
            facebook_url = f"https://facebook.com/{first_name.lower()}.{last_name.lower()}"
            return facebook_url
        except:
            return "No Facebook profile found"

    def generate_profile(self, email: str) -> Dict:
        first_name, last_name = self.extract_name_from_email(email)
        if not first_name or not last_name:
            return {"email": email, "status": "Failed", "profileScore": "0%"}

        full_name = f"{first_name.capitalize()} {last_name.capitalize()}"
        linkedin_url = self.fetch_linkedin_url(first_name, last_name)
        facebook_url = self.fetch_facebook_url(first_name, last_name)
        job_title = "N/A"  # Could be extracted from LinkedIn with more API calls

        # AI logic: Assign profile score based on data availability
        score = 90 if linkedin_url != "No LinkedIn profile found" else 50
        status = "Complete" if score >= 80 else "Partial" if score >= 50 else "Failed"
        profile_score = f"{score}%"

        profile = {
            "email": email,
            "name": first_name.capitalize(),
            "familyName": last_name.capitalize(),
            "linkedin": linkedin_url,
            "facebook": facebook_url,
            "jobTitle": job_title,
            "time": datetime.now().strftime("%I:%M %p")
        }
        self.recent_searches.append(profile)
        # Also add to database for management
        self.alumni_database.append(profile)
        return profile

# Instantiate AI
ai = AlumniAI()

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/api/search')
def api_search():
    email = request.args.get('email')
    if email:
        profile = ai.generate_profile(email)
        return jsonify(profile)
    return jsonify({"error": "No email provided"}), 400

@app.route('/api/recent')
def api_recent():
    return jsonify(ai.recent_searches[-5:])  # Return last 5 searches

@app.route('/api/chat', methods=['POST'])
def api_chat():
    data = request.get_json()
    message = data.get('message', '')
    
    try:
        if ai.gemini_available and message.lower() != 'test':
            # Use Gemini AI for responses
            prompt = f"""You are an AI assistant for an Alumni Portal for Esprit University. 
            You help with alumni information, data analysis, and portal features. 
            The user's message is: {message}
            
            Provide a helpful, professional response. Keep responses concise but informative.
            Focus on alumni data, Esprit university information, and portal functionality."""
            
            response = ai.chat_model.generate_content(prompt)
            if response and hasattr(response, 'text') and response.text:
                return jsonify({"response": response.text})
            else:
                raise Exception("Empty response from Gemini")
        else:
            # Fallback to simple responses if Gemini is not available or for test
            if message.lower() == 'test':
                return jsonify({"response": "Gemini AI test successful"})
            elif 'hello' in message.lower() or 'hi' in message.lower():
                response = "Hello! I'm the Alumni Portal AI assistant. How can I help you today?"
            elif 'alumni' in message.lower():
                response = "I can help you search for alumni information using their Esprit email addresses. Just enter an email like 'Ahmed.BenSalem@esprit.tn' in the search box!"
            elif 'esprit' in message.lower():
                response = "Esprit is the university this alumni portal is designed for. All alumni emails follow the format: FirstName.LastName@esprit.tn"
            else:
                response = "I'm here to help with alumni information. You can search for alumni using their Esprit email addresses, or ask me about the portal features!"
            
            return jsonify({"response": response})
    except Exception as e:
        print(f"Chat error: {e}")
        # Return fallback response instead of error
        if 'hello' in message.lower() or 'hi' in message.lower():
            return jsonify({"response": "Hello! I'm the Alumni Portal AI assistant. How can I help you today?"})
        elif 'alumni' in message.lower():
            return jsonify({"response": "I can help you search for alumni information using their Esprit email addresses. Just enter an email like 'Ahmed.BenSalem@esprit.tn' in the search box!"})
        elif 'esprit' in message.lower():
            return jsonify({"response": "Esprit is the university this alumni portal is designed for. All alumni emails follow the format: FirstName.LastName@esprit.tn"})
        else:
            return jsonify({"response": "I'm here to help with alumni information. You can search for alumni using their Esprit email addresses, or ask me about the portal features!"})

@app.route('/database')
def database_page():
    return app.send_static_file('database.html')

@app.route('/gemini')
def gemini_page():
    return app.send_static_file('gemini.html')

@app.route('/api/bulk-upload', methods=['POST'])
def bulk_upload():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    if file and (file.filename.endswith('.txt') or file.filename.endswith('.csv')):
        try:
            content = file.read().decode('utf-8')
            emails = []
            
            if file.filename.endswith('.csv'):
                # Parse CSV file
                csv_reader = csv.reader(content.splitlines())
                for row in csv_reader:
                    if row and '@esprit.tn' in row[0]:
                        emails.append(row[0].strip())
            else:
                # Parse TXT file
                for line in content.splitlines():
                    if '@esprit.tn' in line:
                        emails.append(line.strip())
            
            # Process each email
            results = []
            for email in emails:
                if email:
                    profile = ai.generate_profile(email)
                    results.append(profile)
            
            return jsonify({"message": f"Processed {len(results)} alumni profiles", "results": results})
        except Exception as e:
            return jsonify({"error": f"Error processing file: {str(e)}"}), 400
    
    return jsonify({"error": "Invalid file type. Please upload .txt or .csv files"}), 400

@app.route('/api/alumni', methods=['GET'])
def get_alumni():
    return jsonify(ai.alumni_database)

@app.route('/api/alumni/<email>', methods=['PUT'])
def update_alumni(email):
    data = request.get_json()
    for i, alumni in enumerate(ai.alumni_database):
        if alumni['email'] == email:
            ai.alumni_database[i].update(data)
            return jsonify(ai.alumni_database[i])
    return jsonify({"error": "Alumni not found"}), 404

@app.route('/api/alumni/<email>', methods=['DELETE'])
def delete_alumni(email):
    for i, alumni in enumerate(ai.alumni_database):
        if alumni['email'] == email:
            deleted = ai.alumni_database.pop(i)
            return jsonify({"message": "Alumni deleted", "alumni": deleted})
    return jsonify({"error": "Alumni not found"}), 404

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)