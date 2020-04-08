/*
Copyright 2019 Square Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const express = require("express");
const { randomBytes } = require("crypto");
const { retrieveOrderAndLocation, loyaltyInstance } = require("../util/square-connect-client");

const router = express.Router();

/**
 * Matches: GET /order-confirmation
 *
 * Description:
 *  Renders a confirmation page with order details.
 *
 *  If the order isn't paid, we throw error.
 *
 * Query Parameters:
 *  order_id: Id of the order to be updated
 *  location_id: Id of the location that the order belongs to
 */
router.get("/", async (req, res, next) => {
  // Post request body contains id of item that is going to be purchased
  const { order_id, location_id } = req.query;
  try {
    const { order_info, location_info } = await retrieveOrderAndLocation(order_id, location_id);
    if (!order_info.order.tenders || order_info.order.tenders.length == 0 ) {
      // For simplicity, we throw error. You can handle this more gracefully
      throw new Error("order not paid");
    }

    // // Check if this order is eligible for accumulating loyalty point
    // const result = await loyaltyInstance.searchLoyaltyEvents({
    //   query: {
    //     filter: {
    //       order_filter: {
    //         order_id: order_id
    //       }
    //     }
    //   }
    // });

    // console.log(result);

    res.render("order-confirmation", {
      location_info,
      order_info
    });
  }
  catch (error){
    next(error);
  }
});



/**
 * Matches: POST /order-confirmation/add-loyalty-point/
 *
 * Description:
 *  Take phone number and accumulate the loyalty point, if phone number is new,
 *  create a new loyalty account automatically.
 *
 * Request Body:
 *  order_id: Id of the order to be updated
 *  location_id: Id of the location that the order belongs to
 *  phone_number: Phone number that related to a loyalty account
 */
router.post("/add-loyalty-point", async (req, res, next) => {
  const { order_id, location_id, phone_number } = req.body;
  try {
    // get the latest order information in case the price is changed from a different session
    const formated_phone_number = `+1${phone_number}`;
    console.log(phone_number);

    const { programs } = await loyaltyInstance.listLoyaltyPrograms();
    console.log(programs);
    if (!programs || !programs[0]) {
      throw new Error("program is not created.");
    }
    const program = programs[0];

    console.log("start searchLoyaltyAccounts.");
    const { loyalty_accounts } = await loyaltyInstance.searchLoyaltyAccounts({
      query: {
        mappings: [
          {
            type: "PHONE",
            value: formated_phone_number
          }
        ]
      }
    });

    let current_loyalty_account = loyalty_accounts && loyalty_accounts[0];
    if (!current_loyalty_account) {
      console.log("create new loyalty account.");
      const { loyalty_account } = await loyaltyInstance.createLoyaltyAccount({
        idempotency_key: randomBytes(45).toString("hex").slice(0, 45), // Unique identifier for request that is under 46 characters
        loyalty_account: {
          mappings: [
            {
              type: "PHONE",
              value: formated_phone_number
            }
          ],
          "program_id": program.id
        }
      });
      current_loyalty_account = loyalty_account;
    }
    console.log(current_loyalty_account);
    console.log("calculate loyalty point.");
    const { points } = await loyaltyInstance.calculateLoyaltyPoints(program.id, {
      order_id: order_id
    });

    // TODO: temporarily add points check before accumulateLoyaltyPoints is fixed
    if (points > 0) {
      console.log("start accumulate loyalty point.");
      const { event } = await loyaltyInstance.accumulateLoyaltyPoints(current_loyalty_account.id, {
        idempotency_key: randomBytes(45).toString("hex").slice(0, 45), // Unique identifier for request that is under 46 characters
        location_id: location_id,
        accumulate_points: {
          order_id: order_id
        }
      });
      console.log(event);
    }

    // redirect to order confirmation page once the order is paid
    res.redirect(`/order-confirmation?order_id=${order_id}&location_id=${location_id}`);
  }
  catch (error) {
    next(error);
  }
});

module.exports = router;
