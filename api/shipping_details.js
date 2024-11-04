require('dotenv').config();
const { Client } = require('pg');
const cors = require('cors');

let client;

function getClient() {
  if (!client) {
    client = new Client({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
    });
    client.connect().catch(err => console.error("Error connecting to database", err));
  }
  return client;
}

async function getShippingDetails(orderNo, courier_partner, service_type) {
  const query = `
    WITH final_shipping_details AS (
      SELECT 
          od."Order No", 
          bm.box_name,  
          CASE 
              WHEN bm.dimensional_weight > od."Dead Weight" THEN bm.dimensional_weight
              ELSE od."Dead Weight"
          END AS actual_weight,
          CASE 
              WHEN CASE 
                       WHEN bm.dimensional_weight > od."Dead Weight" THEN bm.dimensional_weight
                       ELSE od."Dead Weight"
                   END < 2 THEN 0.5
              WHEN CASE 
                       WHEN bm.dimensional_weight > od."Dead Weight" THEN bm.dimensional_weight
                       ELSE od."Dead Weight"
                   END < 5 THEN 2
              WHEN CASE 
                       WHEN bm.dimensional_weight > od."Dead Weight" THEN bm.dimensional_weight
                       ELSE od."Dead Weight"
                   END < 10 THEN 5
              WHEN CASE 
                       WHEN bm.dimensional_weight > od."Dead Weight" THEN bm.dimensional_weight
                       ELSE od."Dead Weight"
                   END < 20 THEN 10
              ELSE 20
          END AS weight_slab
      FROM 
          order_data AS od 
      INNER JOIN 
          box_master AS bm ON bm.box_name = od."Box size"
      WHERE 
          od."Order No" = $1
      LIMIT 1
    ),
    min_shipping_charges AS (
      SELECT 
          weight_slab, 
          MIN("Shipping Charge(Base)") AS min_charge
      FROM 
          shipping_charges
      GROUP BY 
          weight_slab
    )
    SELECT 
      fsd."Order No",
      fsd.box_name,
      fsd.actual_weight,
      fsd.weight_slab,
      sc.courier_partner,
      sc."COD_value_INR",
      sc."COD_perce",
      sc."Shipping Charge(Base)",
      sc.add_charges,
      sc.add_charge_weight,
      sc.service_type,
      (fsd.actual_weight + sc."Shipping Charge(Base)" + sc.add_charges) AS total_cost
    FROM 
      final_shipping_details AS fsd
    INNER JOIN 
      shipping_charges AS sc 
    ON 
      fsd.weight_slab = sc.weight_slab
    INNER JOIN 
      min_shipping_charges AS msc 
    ON 
      sc.weight_slab = msc.weight_slab 
      AND sc."Shipping Charge(Base)" = msc.min_charge 
    WHERE 
      sc.courier_partner = $2 
      AND sc.service_type = $3;
  `;

  try {
    const client = getClient();
    const res = await client.query(query, [orderNo, courier_partner, service_type]);
    if (res.rows.length > 0) {
      return res.rows[0]; 
    } else {
      return { error: "No data found for this order number" }; 
    }
  } catch (err) {
    console.error('Error executing query', err.stack);
    throw err;
  } 
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Enable CORS
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    // Handle CORS preflight request
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Please use POST.' });
    return;
  }

  const { orderNo, courier_partner, service_type } = req.body;

  try {
    if (!orderNo) {
      return res.status(400).json({ error: 'Order number is required.' });
    } else if (!courier_partner) {
      return res.status(400).json({ error: 'Courier Partner is required.' });
    }

    const details = await getShippingDetails(orderNo, courier_partner, service_type);

    if (details.error) {
      return res.status(404).json(details); 
    }

    return res.json(details);
  } catch (error) {
    console.error('Failed to retrieve shipping details', error); 
    return res.status(500).json({ error: 'Failed to retrieve shipping details', details: error.message });
  }
};
