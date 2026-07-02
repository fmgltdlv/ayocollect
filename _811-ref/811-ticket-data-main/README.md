# Utility Ticket Management & Data Ingestion Tools

## How Ticket Management Works (High-Level Overview)

Utility ticket management systems exist to help excavators, contractors, and project teams **track, interpret, and act on 811 / one-call dig tickets** after they are created. While implementations vary by region and organization, the general process follows a common flow:

1. **Ticket Creation**  
   A user (excavator, contractor, or agent) creates a dig ticket in an official one-call system such as **USAN** or **DigAlert**, defining the scope of work, location, and planned excavation dates.

2. **Ticket Ingestion**  
   Once created, ticket information becomes available to downstream systems in one of two common ways:
   - The ticket data is transmitted directly to a ticket management system (e.g., via integrations or webhooks), or  
   - The ticket management system reads or retrieves ticket data from the USAN / DigAlert system after creation.
  
   Tickets are not ingested by the user manually entering the ticket number in the ticket management system **unless** the ticket was created outside of the users organization. Scenarios this would happen:
   - By field personnel who's primary duties do not typically involve calling in dig tickets
   - By another company that the organization is subcontracting from/to to be aware of the responses from utilities for project tracking purposes

4. **Data Parsing & Normalization**  
   The ticket management system parses the incoming data to extract key fields, which may include:
   - Ticket polygon or area of interest
   - Address and location metadata
   - Utility operators notified on the ticket
   - Operator response codes and status updates
   - Ticket start dates, expiration dates, and lifecycle status

5. **Excavation Readiness Evaluation**  
   Using the parsed information, the system evaluates whether a ticket is **ready for excavation** or requires further action. This evaluation is typically based on:
   - Operator response codes (e.g., marked, clear, no conflict, pending)
   - Whether all required operators have responded
   - Ticket start date and legal excavation window
   - Ticket expiration and renewal status

This repository contains tooling and experiments that focus on **steps 2–4** of this process: ingesting ticket data, parsing and normalizing it, and evaluating ticket status for operational decision-making.

---

## Repository Purpose

This is **not a single monolithic application**. Each component can be used independently or combined depending on the use case.

---

## Repository Structure

### multi-ticket-retriever/

**Multi-Region Ticket Query Tool**

A tool for querying Underground Service Alert tickets from multiple regions (Northern California and Nevada) and querying them by geographic area.

**Features:**
- Queries tickets from both **USAN Northern California (CA)** and **Nevada (NV)** systems
- Sequential date-range querying with automatic progress saving
- Stores tickets in SQLite database with polygon coordinates and ticket properties
- Geographic querying by bounding box or point coordinates
- Export to GeoJSON, CSV, or reduced database files
- Background execution support for long-running queries on GCP VMs
- GUI and CLI interfaces

**Used for:**
- Bulk ticket data collection across date ranges
- Geographic area analysis and mapping
- Multi-region ticket workflow research
- Production data ingestion pipelines

**See `multi-ticket-retriever/README.md` for detailed usage instructions.**


---

### digalert_gui_standalone.py

**DigAlert Ticket Query (Standalone GUI Tool)**

A standalone Python script with a GUI interface designed to:
- Read and extract ticket information from DigAlert (California)
- Assist with exploratory data access and workflow testing
- Reduce manual effort when reviewing or analyzing ticket data

Intended for internal testing and research.

---

### nv ticket reader/

**Nevada (NV811 / One Call) Ticket Reader**

Code focused on reading and extracting ticket information from Nevada 811-related systems.

Used to:
- Explore Nevada ticket data structures
- Normalize ticket information for downstream processing
- Support internal analytics and mapping experiments

Contents may include scripts, helpers, and experimental logic.

---

### usan nca reader/

**USAN – Northern California Ticket Reader**

Reader code focused on **USAN Northern California (NCA)** ticket data.

Used to:
- Understand regional differences in ticket formats
- Test cross-region normalization strategies
- Support multi-region ticket workflow research

---

### usan-webhook/

**USAN Webhook Test & Prototype Code**

Experimental code for receiving and handling **USAN webhooks**.

Used to:
- Explore event-driven ticket updates
- Validate webhook payload structures
- Test ingestion pipelines without relying solely on querying

> ⚠️ Experimental test code only.

---

## Purpose & Philosophy

This repository exists to:
- Explore programmatic ingestion of 811 / USAN ticket data
- Prototype ticket management and visualization concepts
- Compare **pull-based (querying)** vs **push-based (webhook)** data models
- Understand regional differences across ticketing systems

Much of the code is **experimental by design** and may change frequently.

---

## Notes & Disclaimer

- Intended for **research, prototyping, and internal tooling**
- Code may rely on undocumented endpoints or brittle selectors
- Not production-ready without additional validation
- Usage must comply with all applicable terms of service, agreements, and regulations

---

## Getting Started

Each script or folder is largely self-contained.

**For the multi-ticket-retriever tool:**
- See `multi-ticket-retriever/README.md` for quick start instructions
- Supports both CA and NV systems
- Can run in background mode for long-running queries

**General guidance:**
- Review inline comments before running any code
- Avoid committing credentials or secrets
- Document environment variables locally if required

---

## Contact / Ownership

Maintained by Charles Folashade Jr.  
For questions or collaboration, reach out directly.

