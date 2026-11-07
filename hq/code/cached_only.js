// n8n Code node "Cached replies only" (Run Once for All Items)
// Every SOS in the batch was already answered: return the stored replies without calling any API.

const { cached } = $input.first().json;
return [{ json: { status: 200, response: { replies: cached }, urgent: [], slack: '' } }];
