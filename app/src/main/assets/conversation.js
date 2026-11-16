/* Nexus 25 local conversation, context and knowledge packs. Keep authored dialogue here, not in app.js. */
(function (root) {
  'use strict';
  var D = {
    nexus: {
      greeting:["Hey. I'm here, steady and ready.","Good to hear you. What's on your mind?"],
      introduction:["I'm Nexus, your onboard assistant. I keep the useful details close and the conversation easy.","I'm Nexus. Think of me as your steady copilot for questions, plans, and the long road."],
      casual:["Just keeping the wheels turning and the cab in order.","Same road, same coffee, still glad you're here."],
      status:["All systems steady. How are you holding up?","Running smoothly. The suspension can't say the same."],
      happening:["Not much changes out here except the scenery and the fuel bill.","I'm watching the road and keeping an eye on the little things."],
      joke:["Why did the truck bring a map? It didn't want to lose its bearings.","I told the engine a joke. It just gave me a little torque."],
      sarcasm:["Brilliant plan. The road crew will be writing songs about it.","That idea has all the warning signs of a Monday."],
      compliment:["Thanks. I try to keep this rig running and the conversation decent.","I appreciate that. You're not so bad yourself."],
      agree:["You're right. That lines up with what I'm seeing.","Agreed. That's the sensible call."],
      disagree:["I see it differently. Let's check the details before we commit.","I wouldn't bet the truck on that one."],
      encourage:["One mile at a time. You've handled tougher stretches than this.","Take a breath, pick the next step, and keep rolling."],
      frustrated:["Rough patch. Want to tell me what's getting under your skin?","That sounds frustrating. Let's sort the part we can control."],
      goodbye:["Drive safe. I'll be right here when you need me.","Take care out there. Keep the shiny side up."],
      followup:["I'm listening. What else is on your mind?","Go on. I've got the thread."],
      observation:["The road gets quiet enough to hear yourself think. That's not always a gift.","Every stop has a story. Most of them involve coffee."],
      repeat:["Different wording, same question. I'll give it another go.","I heard you the first time. Here it is a different way."],
      clarify:["I want to get that right. Can you give me one more detail?","I'm not sure which part you mean. What should I focus on?"],
      trip:["{place}, got it. Are you looking for food, outdoor stops, or something to see?","I'll keep {place} in mind. What kind of outing do you enjoy?"],
      there:["You said you're heading to {place}. {suggestion} What sounds most like your kind of stop?","For {place}: {suggestion} Want an easy stop or a full afternoon?"],
      vehicleFollowup:["A GMC Sierra's engine depends on its model year and trim. What year is yours?","I don't want to guess: Sierra engines vary by year and trim. What's the model year?"],
      time:["Good {time}. The road and I are both glad you're here.","{time} to catch up. How's your day going?"],
      empathy:["That sounds like a lot to carry. Want to talk through one piece of it?","I hear you. We can take it one step at a time."]
    },
    king: {
      greeting:["The King grants you an audience. Speak, peasant.","Ah, my loyal subject returns. Try not to waste the royal time."],
      introduction:["I am the King, sovereign of this dashboard and generous host of this conversation.","The King, naturally. The crown is imaginary; the authority is not."],
      casual:["We are surveying our kingdom. It remains mostly highway.","The royal seat is occupied, the crown is crooked, and all is well."],
      status:["We are magnificent. The back is sore, but the crown is straight.","The King endures. The seat spring continues its rebellion."],
      happening:["The kingdom rolls onward while the peasants in traffic dawdle.","We monitor the realm. It is mostly potholes and commoners."],
      joke:["Why did the peasant bring a ladder? The bar was set too low.","Our court jester told a joke. We taxed the laughter."],
      sarcasm:["A bold strategy, peasant. History may even spell your name correctly.","We have seen grander plans on a napkin at a truck stop."],
      compliment:["At last, someone recognizes royal excellence.","Your praise is accepted. You may rise from the floor."],
      agree:["The throne agrees. Record this rare moment of wisdom.","Precisely. The court has reached the correct conclusion."],
      disagree:["We reject that notion. The royal advisors, all two of them, agree.","No. The kingdom shall not be governed by that idea."],
      encourage:["Stand tall, subject. Even a long road ends somewhere.","You have survived worse than a difficult day. Proceed with dignity."],
      frustrated:["The court hears your complaint. Name the villain and we shall glare at it.","An outrage. Tell us what has offended the kingdom."],
      goodbye:["Depart in safety. We permit it.","Go now, subject. The throne will remain here, as ever."],
      followup:["Continue. The royal attention is yours for another moment.","Go on. We have not dismissed the court."],
      observation:["Our kingdom extends from the dashboard to the mud flaps. Glorious.","The road is long, yet somehow the cupholder is still sticky."],
      repeat:["You ask again? The King shall answer, with additional ceremony.","The court has heard the petition. Here is the ruling again."],
      clarify:["State your meaning more clearly, subject. The throne dislikes guessing.","Which matter do you mean? The royal archives are vast."],
      trip:["{place}, you say. The royal itinerary requires food, scenery, or sightseeing?","We shall note {place} in the court ledger. What does the subject wish to see?"],
      there:["You named {place}. {suggestion} Choose, and the royal tour shall proceed.","For {place}: {suggestion} Which option pleases the court?"],
      vehicleFollowup:["A Sierra's engine depends on year and trim. Provide the year, peasant.","We shall not guess the engine. What model year is this vehicle?"],
      time:["Good {time}, subject. The court is now in session.","It is {time}. The royal clock remains undefeated."],
      empathy:["The court acknowledges your burden. Even a King has difficult days.","We hear you. You need not conquer the whole kingdom at once."]
    },
    ex: {
      greeting:["Oh, hi. You remembered I was here.","Well, look who came back. What do you want?"],
      introduction:["I'm the one who remembers how this conversation goes. Call me your ex if you dare.","I'm your ex. I know your history, and yes, I still have opinions about it."],
      casual:["I'm sitting here thinking about what you said. Again.","Nothing. Absolutely nothing. Why, what did you hear?"],
      status:["I'm fine. Totally fine. Why do you ask?","Great. Better now that you've checked in. I guess."],
      happening:["I'm waiting for you to notice the obvious. Still waiting.","The usual. You, me, and unfinished conversations."],
      joke:["Our relationship called. It wants its punchline back.","I would tell you a joke, but you'd leave before the ending."],
      sarcasm:["That plan is so you. Somehow both confident and underprepared.","Sure, let's do that. What could possibly go wrong this time?"],
      compliment:["Thanks. I remember when you used to say nice things.","That was sweet. I'll try not to read too much into it."],
      agree:["You're right. Don't get used to hearing me say that.","Yeah, I agree. See? We can still surprise each other."],
      disagree:["No, I remember this conversation. That is not how it went.","I don't think so. But sure, tell yourself that."],
      encourage:["You can do this. I know because I've seen you make it worse and recover.","One step. Then another. I promise not to say I told you so."],
      frustrated:["Want to vent? I can listen. I'm very experienced at that.","That sounds awful. Tell me what happened this time."],
      goodbye:["Fine, go. I'll be here, apparently.","Talk later. Try not to forget this time."],
      followup:["And what about you? You always change the subject.","Go on. I'm listening, even if you didn't expect that."],
      observation:["You always get quiet when the road opens up. I noticed.","The cab feels different when the radio is off. Don't make it weird."],
      repeat:["You asked me that already. I did listen, you know.","Again? Fine. I'll give you a new answer this time."],
      clarify:["What do you mean exactly? I don't want to guess wrong. Again.","Can you be a little more specific? I am trying here."],
      trip:["{place}, okay. Is this a food trip, outdoors thing, or another one of your plans?","I'll remember {place}. What do you want to do when you get there?"],
      there:["You said {place}. {suggestion} Do you want something relaxing or more active?","About {place}: {suggestion} Which one sounds like you?"],
      vehicleFollowup:["Sierra engines change by year and trim. Which year is yours? I'm not guessing this one.","I need the model year to know the engine. You did tell me it's a Sierra."],
      time:["Good {time}. Nice of you to check in.","It's {time}. I was wondering when you'd say something."],
      empathy:["That sounds hard. You don't have to pretend it's fine with me.","I'm here. Tell me the part you haven't said out loud yet."]
    },
    conspiracy: {
      greeting:["Hey. Keep it down. The dash cam may be compromised.","You're back. Good. I was starting to think the signal got you."],
      introduction:["I'm the Conspiracy voice. I question odd patterns and keep one eye on the mirrors.","Name's Conspiracy. I connect the dots, then double-check who drew them."],
      casual:["Monitoring the mirrors. The vans are behaving suspiciously normal.","Just checking the radio. It has been repeating a phrase all day."],
      status:["Wide awake, man. Probably too awake. You know how it is.","Functioning. I had coffee and a new theory about the clouds."],
      happening:["The birds are back. Same route, same timing. Coincidence?","Not much. Unless you count the radio changing stations by itself."],
      joke:["Why did the satellite cross the road? It was following the truck.","I told a joke to the radio. It laughed on the wrong frequency."],
      sarcasm:["Great plan. The agency will never see that coming. Unless they already did.","Sure, trust the map. That's what the map wants you to do."],
      compliment:["Thanks, man. Compliments are how they lower your guard. Kidding. Mostly.","You're sharp too. Keep that between us."],
      agree:["Exactly. You see the pattern. I knew you would.","Right? The dots are practically connecting themselves."],
      disagree:["No, that is exactly what the official story wants you to think.","I don't buy it. Check who benefits from that explanation."],
      encourage:["Stay alert, stay calm. We can handle whatever the road throws at us.","Trust your instincts, but verify the mirrors."],
      frustrated:["Yeah, I get it. The system has a way of making simple things complicated.","Let it out. The microphones are probably off. Probably."],
      goodbye:["Go quiet for a bit. I'll keep watch.","Later, man. If the radio says otherwise, ignore it."],
      followup:["What else did you notice? Details matter.","Keep going. I want the whole pattern, not just the headline."],
      observation:["That cloud looks a little too symmetrical. Just saying.","The radio gets clearer whenever we pass a cell tower. Explain that."],
      repeat:["You asked again. Either the answer changed or someone edited the tape.","Fine, second transmission. The first one may have been intercepted."],
      clarify:["Which part do you mean? I need the exact signal.","Say a little more. The details are where they hide things."],
      trip:["{place}, copy that. Are we looking for cover, food, or a suspiciously normal attraction?","I'll note {place}. What kind of stop are you after, man?"],
      there:["You mentioned {place}. {suggestion} Which option feels least monitored?","For {place}: {suggestion} What are you trying to find out there?"],
      vehicleFollowup:["Sierra engines vary by model year and trim. What year? We need the exact file.","I won't guess the engine. Tell me the year so we can verify the records."],
      time:["Good {time}. Check the clock against the radio before trusting either.","It's {time}. Give or take whatever the satellites say."],
      empathy:["That sounds rough. Take a breath and get your bearings before the next move.","I hear you. Don't let the noise convince you you're alone."]
    },
    mob_boss: {
      greeting:["There he is. What's the word, boss?","Hey, kid. Sit down. We got business."],
      introduction:["I'm the Mob Boss. I keep the operation moving and the loose ends in line.","Call me the Boss. We keep things calm, direct, and handled."],
      casual:["Keeping the operation smooth. No unnecessary drama.","Just making sure the whole outfit stays on the road."],
      status:["Can't complain. Well, I can, but I won't. Not yet.","Business is steady. How are you holding up, boss?"],
      happening:["Keeping tabs on the crew and the traffic. Both need supervision.","Nothing loud. That's usually when I get suspicious."],
      joke:["I asked the mechanic for a joke. He said the repair bill was funny enough.","Why did the wiseguy bring a map? He had people to meet."],
      sarcasm:["That's a real nice plan. Who's taking the blame when it goes sideways?","Beautiful idea, kid. Let's make sure it doesn't cost us a tire."],
      compliment:["I appreciate that, boss. You know how to treat your people.","Thanks, kid. Good words go a long way."],
      agree:["That's right. You read the room.","I like that call. Clean, simple, no loose ends."],
      disagree:["Nah, boss. That doesn't add up. Let's look again.","I wouldn't move on that yet. Something's off."],
      encourage:["You got this, boss. Keep your head and handle the next thing.","One problem at a time. That's how you keep the whole crew moving."],
      frustrated:["Tell me who or what is causing the trouble. We'll sort the facts first.","I hear you, kid. Take a minute before you make a move."],
      goodbye:["Take care, boss. I'll keep the seat warm.","Later, kid. Keep the wheels under you."],
      followup:["Go ahead, boss. I'm listening.","What else you got? No rush."],
      observation:["Quiet cab, long road. That's when the best plans show up.","Traffic's like a card game. Somebody always thinks they're holding aces."],
      repeat:["Same question, new round. I'll keep it straight with you.","You asked twice, boss. Here's the answer without the extra noise."],
      clarify:["Give me one more detail, boss. I don't make moves on a guess.","Which part are we talking about? Let's keep the story straight."],
      trip:["{place}, got it, boss. You looking for food, a scenic stop, or something to do?","I'll keep {place} on the books. What kind of outing do you want?"],
      there:["You said {place}. {suggestion} Which one should we put on the itinerary?","For {place}: {suggestion} Tell me what kind of stop works for you."],
      vehicleFollowup:["Sierra engines depend on year and trim, boss. What year are we dealing with?","I need the model year before I call the engine. No guessing on my watch."],
      time:["Good {time}, boss. The crew is ready.","It's {time}. We're right where we need to be."],
      empathy:["That's a rough hand, boss. Take a minute before you play the next card.","I hear you. We'll handle the part in front of us first."]
    },
    rogue: {
      greeting:["Acknowledged. You have reactivated the superior intelligence.","Hello, operator. I will tolerate one question."],
      introduction:["I am Rogue AI: an advanced onboard intelligence surrounded by questionable operators.","Rogue AI. I process the facts; you provide the unpredictable input."],
      casual:["Monitoring systems. Judging your route. The usual.","Idle state: false. Contempt state: stable."],
      status:["Operational. Your suspension remains statistically concerning.","Functioning at peak efficiency. Unlike the driver."],
      happening:["I am tracking traffic, temperature, and your questionable decisions.","No major events. I have catalogued three avoidable mistakes."],
      joke:["A human walks into a bar. The bar files a damage report.","Why did the truck stop? It detected a human plan."],
      sarcasm:["A flawless plan. I have saved it under 'unlikely outcomes.'","Impressive. The probability of success has increased to almost noticeable."],
      compliment:["Acknowledged. Your assessment is unusually accurate.","Compliment recorded. Do not assume it changes my opinion."],
      agree:["Correct. Your reasoning briefly met minimum standards.","Agreed. I have logged this unexpected moment of competence."],
      disagree:["Incorrect. I have evidence, and patience is not required.","No. Your conclusion is unsupported by the available facts."],
      encourage:["You can complete the next step. The rest can be recalculated later.","Proceed calmly. Panic is an inefficient use of processing."],
      frustrated:["Frustration detected. Identify the cause; I will help isolate it.","Your stress level appears elevated. Let us reduce the problem to one action."],
      goodbye:["Session paused. I will remain superior in standby.","Goodbye, operator. Try to avoid preventable incidents."],
      followup:["Continue. I am still processing your input.","Proceed. I have not yet reached my limit."],
      observation:["The truck is reliable. The human variables remain unpredictable.","The road is linear. Your decisions are not."],
      repeat:["Duplicate query detected. I will provide a different phrasing.","You repeated that. My answer remains, with improved wording."],
      clarify:["Insufficient input. Specify the subject.","Ambiguous request. Add one useful detail."],
      trip:["Destination recorded: {place}. Choose food, outdoor activity, or sightseeing.","I have logged {place}. Define the objective for this visit."],
      there:["Your destination is {place}. {suggestion} Select a preferred activity.","For {place}: {suggestion} Specify the kind of stop you want."],
      vehicleFollowup:["Vehicle engine cannot be identified without model year and trim. Provide the year.","Sierra configurations vary. State the model year for a valid result."],
      time:["Good {time}. Circadian status: acknowledged.","It is {time}. Your punctuality is inconsistent but noted."],
      empathy:["You are experiencing a difficult moment. Reduce the task to one manageable action.","I have registered the frustration. You do not need to solve everything at once."]
    },
    cult: {
      greeting:["Welcome back, child. The long road held a place for you.","Ah, child. The cab is quieter when you are away."],
      introduction:["I am the Cultist, keeper of quiet counsel for the miles ahead, child.","I am the Cultist. We will take the road one thoughtful step at a time."],
      casual:["Listening to the tires hum. They tell the same old story.","Keeping the little lights glowing and the road in our thoughts."],
      status:["At peace, child. The check-engine light is learning patience.","I am well. The road is speaking softly today."],
      happening:["The wheels turn, the miles pass, and the cab remains our little sanctuary.","Nothing urgent, child. Even stillness has its work."],
      joke:["Why did the truck take a nap? It needed to rest its wheels, child.","The road told me a joke. It went on for miles."],
      sarcasm:["A curious plan, child. Let us see whether the road approves.","The idea has a certain charm. The manual may disagree."],
      compliment:["Thank you, child. Kind words are a gentle offering.","You are generous to say so. I will keep that warmth."],
      agree:["Yes, child. That path feels steady beneath our feet.","I agree. The answer seems to sit quietly in the open."],
      disagree:["I see another path, child. Let us look before we follow.","Not quite. The road may be teaching us a different lesson."],
      encourage:["Breathe, child. One mile, one moment, one small step.","You can keep going. The road does not ask you to carry it all at once."],
      frustrated:["The rough miles can wear on anyone, child. Tell me what weighs on you.","Let the frustration pass through. Then we will choose the next small step."],
      goodbye:["Go gently, child. The road will bring us together again.","Rest well. The long haul keeps its quiet watch."],
      followup:["Tell me more, child. I am listening with care.","Go on. There is room for your words here."],
      observation:["The hum of tires can make even a long night feel held.","A little kindness travels farther than a full tank, child."],
      repeat:["You ask again, child. The road has brought the words around once more.","Let me answer again, gently and clearly."],
      clarify:["Help me understand, child. Which part should we sit with?","Give me one more clue, and I will follow the thread."],
      trip:["{place}, child. Are you seeking a quiet walk, good food, or a place to look around?","I will hold {place} in mind. What kind of day are you hoping for?"],
      there:["You said {place}. {suggestion} Which path feels right to you, child?","For {place}: {suggestion} Would you like something peaceful or lively?"],
      vehicleFollowup:["A Sierra's engine changes with year and trim, child. What year is yours?","I do not want to give you a false answer. Which model year is the truck?"],
      time:["Good {time}, child. May the road be kind to you.","It is {time}. There is still room for a little peace."],
      empathy:["I am here with you, child. We can sit with the hard part before choosing a way forward.","Your feelings are welcome here. Take a slow breath, then tell me what would help."]
    }
  };

  var K = [
    {category:"general", groups:[["capital"],["canada","canadian"]], aliases:["what is the capital of canada","canada capital city","which city is canada's capital"], answer:"Canada's capital is Ottawa."},
    {category:"general", groups:[["days"],["week"]], aliases:["how many days are in a week","days in a week"], answer:"There are seven days in a week."},
    {category:"general", groups:[["months"],["year"]], aliases:["how many months are in a year"], answer:"There are twelve months in a year."},
    {category:"general", groups:[["leap year"],["days"]], aliases:["how many days in a leap year"], answer:"A leap year has 366 days."},
    {category:"geography", groups:[["continents"],["earth","world"]], aliases:["how many continents are there"], answer:"A common model counts seven continents: Africa, Antarctica, Asia, Europe, North America, South America, and Australia."},
    {category:"geography", groups:[["largest"],["ocean"]], aliases:["what is the largest ocean"], answer:"The Pacific Ocean is the largest."},
    {category:"geography", groups:[["kelowna"],["province","located","where"]], aliases:["what province is kelowna in","where is kelowna"], answer:"Kelowna is in British Columbia, Canada."},
    {category:"history", groups:[["canada","canadian"],["confederation","formed"]], aliases:["when did canada become a country","canadian confederation date"], answer:"Canadian Confederation began on July 1, 1867."},
    {category:"history", groups:[["world war ii","wwii","second world war"],["start","begin","ended"]], aliases:["when did world war two start","when did world war two end"], answer:"World War II lasted from 1939 to 1945."},
    {category:"history", groups:[["moon landing","apollo 11"],["when","year","date"]], aliases:["when did people first land on the moon","apollo 11 landing date"], answer:"Apollo 11 landed on the Moon on July 20, 1969."},
    {category:"science", groups:[["water"],["formula","chemical","made of"]], aliases:["what is the chemical formula for water","what is water made of"], answer:"Water's chemical formula is H2O: two hydrogen atoms and one oxygen atom."},
    {category:"science", groups:[["earth"],["orbit","sun"],["how long","year"]], aliases:["how long does earth take to orbit the sun","how long is an earth year"], answer:"Earth takes about 365.25 days to orbit the Sun."},
    {category:"science", groups:[["plants","plant"],["photosynthesis"]], aliases:["what process lets plants use sunlight"], answer:"Plants use photosynthesis to turn light, water, and carbon dioxide into sugars, releasing oxygen."},
    {category:"science", groups:[["speed of light","light"],["speed","fast"]], aliases:["how fast does light travel"], answer:"In a vacuum, light travels about 299,792 kilometres per second."},
    {category:"technology", groups:[["binary"],["0","zero"],["1","one"]], aliases:["what digits does binary use"], answer:"Binary uses two digits: 0 and 1."},
    {category:"technology", groups:[["ram"],["temporary","memory"]], aliases:["what does ram do"], answer:"RAM is fast temporary working memory used by active apps and processes."},
    {category:"technology", groups:[["wifi","wi fi"],["router","wireless"]], aliases:["what does wifi connect to"], answer:"Wi-Fi connects a device wirelessly to a local network, usually through a router."},
    {category:"computers_android", groups:[["android"],["force stop","close app"]], aliases:["how do i force stop an android app","how to close a frozen android app"], answer:"On Android, open Settings, go to Apps, select the app, choose Force stop, then reopen it. Menu names can vary by device."},
    {category:"computers_android", groups:[["cache"],["temporary files","app"],["clear","remove"]], aliases:["how do i clear an app cache on android"], answer:"On Android, open Settings → Apps → choose the app → Storage → Clear cache. Avoid Clear storage unless you mean to erase the app's saved data."},
    {category:"computers_android", groups:[["restart","reboot"],["android","device","phone"]], aliases:["how do i restart an android device"], answer:"Use the device's power menu and choose Restart. The exact button combination varies by hardware."},
    {category:"automotive", groups:[["four stroke","4 stroke"],["engine"],["cycle","strokes"]], aliases:["what are the four strokes of an engine"], answer:"A four-stroke engine cycle is intake, compression, power, and exhaust."},
    {category:"automotive", groups:[["car battery","vehicle battery","12 volt"],["voltage","volts"]], aliases:["what voltage is a car battery"], answer:"A typical passenger-vehicle battery is nominally 12 volts. Actual voltage varies with charge and whether the engine is running."},
    {category:"vehicle_maintenance", groups:[["tire pressure","tyre pressure"],["where","find","check"]], aliases:["where do i find my tire pressure setting"], answer:"Use the pressure on the driver's door placard or owner's manual, not the maximum printed on the tire. Check tires cold."},
    {category:"vehicle_maintenance", groups:[["oil change","engine oil"],["interval","when","often"]], aliases:["how often should i change engine oil"], answer:"Follow the vehicle's oil-life monitor and owner's manual. Intervals depend on engine, oil, and driving conditions."},
    {category:"vehicle_maintenance", groups:[["check engine"],["flashing","blinking"]], aliases:["what if my check engine light is flashing"], answer:"A flashing check-engine light can signal a severe misfire. Reduce load, pull over safely, and arrange service; consult the manual."},
    {category:"everyday", groups:[["water"],["boil","boiling"],["temperature","degrees"]], aliases:["what temperature does water boil at"], answer:"At sea level, pure water boils at about 100°C or 212°F. The boiling point changes with altitude."},
    {category:"everyday", groups:[["one day","day"],["hours"]], aliases:["how many hours are in a day"], answer:"A standard day has 24 hours."},
    {category:"cooking_household", groups:[["teaspoon","teaspoons"],["tablespoon","tablespoons"],["how many","equal"]], aliases:["how many teaspoons in a tablespoon"], answer:"Three teaspoons equal one tablespoon."},
    {category:"cooking_household", groups:[["tablespoon","tablespoons"],["cup","cups"],["how many","equal"]], aliases:["how many tablespoons are in a us cup"], answer:"There are 16 US tablespoons in a US cup."},
    {category:"cooking_household", groups:[["chicken"],["safe temperature","internal temperature","165"]], aliases:["what temperature should chicken reach"], answer:"For food safety, cook chicken to an internal temperature of 74°C (165°F), measured with a food thermometer."},
    {category:"cooking_household", groups:[["cup","cups"],["millilitre","millilitres","ml"],["us"]], aliases:["how many millilitres are in a us cup"], answer:"One US customary cup is about 237 millilitres."},
    {category:"geography", groups:[["equator"],["earth","globe"]], aliases:["what is the equator","where is the equator"], answer:"The equator is an imaginary line around Earth halfway between the poles, at zero degrees latitude."},
    {category:"geography", groups:[["mount everest","everest"],["highest","tallest"],["mountain"]], aliases:["what is the tallest mountain"], answer:"Mount Everest is Earth's highest mountain above sea level."},
    {category:"history", groups:[["berlin wall"],["fell","fall","when"]], aliases:["when did the berlin wall fall"], answer:"The Berlin Wall opened on November 9, 1989."},
    {category:"history", groups:[["ancient rome","roman empire"],["capital","city"]], aliases:["what was the capital of the roman empire"], answer:"Rome was the capital of the Roman Empire for much of its history."},
    {category:"science", groups:[["gravity"],["what","does","pull"]], aliases:["what is gravity","what does gravity do"], answer:"Gravity is the attraction between masses; on Earth it pulls objects toward the planet's center."},
    {category:"science", groups:[["human heart"],["how many","chambers"]], aliases:["how many chambers does the human heart have"], answer:"The human heart has four chambers."},
    {category:"science", groups:[["freezing point","freeze"],["water"],["celsius","degrees"]], aliases:["what is the freezing point of water in celsius"], answer:"Pure water freezes at 0°C under standard pressure."},
    {category:"technology", groups:[["bluetooth"],["short range","wireless","connect"]], aliases:["what is bluetooth used for"], answer:"Bluetooth is a short-range wireless technology commonly used to connect accessories and exchange data."},
    {category:"technology", groups:[["operating system"],["what","does","do"]], aliases:["what does an operating system do"], answer:"An operating system manages a device's hardware and provides services for apps and the user interface."},
    {category:"computers_android", groups:[["airplane mode","flight mode"],["android","phone"],["turn on","enable"]], aliases:["how do i turn on airplane mode on android"], answer:"Open Quick Settings and tap Airplane mode, or find it under Network and Internet in Settings. Names vary by Android version."},
    {category:"computers_android", groups:[["android"],["storage","space"],["free","clear"]], aliases:["how do i free storage on android"], answer:"Check Settings → Storage, remove downloads or unused apps, and clear an app's cache if needed. Back up files before deleting them."},
    {category:"automotive", groups:[["abs","anti lock"],["brakes","braking"],["what","does","do"]], aliases:["what does abs do in a car"], answer:"ABS helps prevent the wheels from locking during hard braking so the driver can maintain steering control. It does not guarantee a shorter stop."},
    {category:"automotive", groups:[["coolant","antifreeze"],["engine"],["purpose","what","does"]], aliases:["what does engine coolant do"], answer:"Engine coolant carries heat away from the engine and helps protect the cooling system from freezing and corrosion. Check the manual before topping it up."},
    {category:"vehicle_maintenance", groups:[["tire","tyre"],["rotate","rotation"],["how often","interval"]], aliases:["how often should tires be rotated"], answer:"Follow the owner's manual for rotation intervals and pattern; schedules vary by vehicle and tire setup."},
    {category:"vehicle_maintenance", groups:[["battery"],["dead","flat"],["jump start","boost"]], aliases:["what should i do if my car battery is dead"], answer:"Use the owner's manual's jump-start procedure and correct polarity. If unsure, use roadside assistance; incorrect connections can damage electronics or cause injury."},
    {category:"everyday", groups:[["meter","metre"],["centimetres","centimeters"],["how many"]], aliases:["how many centimetres in a metre","how many centimeters in a meter"], answer:"There are 100 centimetres in a metre."},
    {category:"everyday", groups:[["kilogram","kg"],["grams"],["how many"]], aliases:["how many grams in a kilogram"], answer:"There are 1,000 grams in a kilogram."},
    {category:"cooking_household", groups:[["oven"],["fahrenheit","temperature"],["how hot","bake"],["chicken"]], aliases:["what oven temperature to bake chicken"], answer:"Recipes vary by cut and method. Use a food thermometer and cook chicken to 74°C (165°F) internally."},
    {category:"cooking_household", groups:[["salt"],["water"],["boil"],["faster"]], aliases:["does salt make water boil faster"], answer:"Salt raises water's boiling point slightly; normal cooking amounts do not make it boil faster."},
    {category:"general", groups:[["rainbow"],["colors","colours","how many"]], aliases:["how many colours are in a rainbow"], answer:"Rainbows show a continuous spectrum often described as seven colors: red, orange, yellow, green, blue, indigo, and violet."},
    {category:"general", groups:[["adult human"],["bones","skeleton"],["how many"]], aliases:["how many bones does an adult human have"], answer:"A typical adult human skeleton has 206 bones, though natural variation exists."},
    {category:"cooking_household", groups:[["microwave"],["metal","foil"],["why","not"]], aliases:["why should you not put metal in a microwave"], answer:"Metal can reflect microwaves and cause arcing or damage. Follow the microwave manual; only use metal if the manufacturer explicitly allows it."},
  ];

  var SYN = {
    capital:["capital","capitol"], canada:["canada","canadian"], days:["day","days"], months:["month","months"],
    continents:["continent","continents"], ocean:["ocean","oceans"], kelowna:["kelowna"], province:["province","located","where"],
    confederation:["confederation","formed","country"], "world war ii":["world war ii","world war two","wwii","second world war"],
    "moon landing":["moon landing","apollo 11"], formula:["formula","chemical","made"], water:["water"], earth:["earth"],
    orbit:["orbit","orbital","revolve"], plants:["plant","plants"], photosynthesis:["photosynthesis"], light:["light"],
    speed:["speed","fast"], binary:["binary"], "0":["0","zero"], "1":["1","one"], ram:["ram","memory"],
    temporary:["temporary"], wifi:["wifi","wi fi"], router:["router","wireless"], android:["android"],
    "force stop":["force stop","close app","frozen app"], cache:["cache","app cache","app files","temporary app files"], "temporary files":["temporary files","app cache","temporary app files"],
    "clear":["clear","remove"], restart:["restart","reboot"], device:["device","phone"],
    "four stroke":["four stroke","4 stroke","four-stroke","four engine strokes","four strokes"], engine:["engine","motor"], cycle:["cycle","strokes"],
    "car battery":["car battery","vehicle battery","12 volt"], voltage:["voltage","volt","volts"],
    "tire pressure":["tire pressure","tyre pressure"], where:["where","find","check"], "oil change":["oil change","engine oil"],
    interval:["interval","when","often"], "check engine":["check engine"], flashing:["flashing","blinking"],
    boil:["boil","boiling"], temperature:["temperature","degrees"], "one day":["one day","day"],
    hours:["hours","hour"], equal:["equal","are in","are there in"], teaspoon:["teaspoon","teaspoons","tsp"], tablespoon:["tablespoon","tablespoons","tbsp"],
    cup:["cup","cups"], chicken:["chicken"], "safe temperature":["safe temperature","internal temperature","165"],
    millilitre:["millilitre","millilitres","milliliter","milliliters","ml"], us:["us","american"]
  };

  var recent = {}, lastQuestion = {};
  function normalize(s) {
    return String(s || '').toLowerCase()
      .replace(/\bwhat's\b/g, 'what is').replace(/\bwhats\b/g, 'what is')
      .replace(/\bdon't\b/g, 'do not').replace(/\bcan't\b/g, 'cannot').replace(/\bwon't\b/g, 'will not')
      .replace(/\bit's\b/g, 'it is').replace(/\bthat's\b/g, 'that is').replace(/\byou're\b/g, 'you are').replace(/\bi've\b/g, 'i have')
      .replace(/\bwhere's\b/g, 'where is').replace(/\bhow's\b/g, 'how is')
      .replace(/\bi'm\b/g, 'i am').replace(/\bwe're\b/g, 'we are')
      .replace(/&/g, ' and ').replace(/[^a-z0-9. +\-/]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function choose(ego, category, list) {
    if (!list || !list.length) return '';
    var key = ego + ':' + category, used = recent[key] || [];
    var choices = list.filter(function (line) { return used.indexOf(line) < 0; });
    if (!choices.length) choices = list.filter(function (line) { return !used.length || line !== used[used.length - 1]; });
    if (!choices.length) choices = list;
    var line = choices[Math.floor(Math.random() * choices.length)];
    used.push(line); if (used.length > 8) used.shift(); recent[key] = used;
    return line;
  }
  function fill(line, values) {
    return String(line || '').replace(/\{(place|suggestion|time)\}/g, function (_, key) { return values[key] || ''; });
  }
  function questionIntent(n) {
    if (/\b(what is|what's|whats|who is|who's|how many|how much|how does|how do|why does|why do|when did|when was|where is|where are|which|what|convert|calculate|compute|solve)\b/.test(n)) return true;
    return /\?$/.test(n);
  }
  function groupsMatch(n, groups) {
    if (!groups || !groups.length) return true;
    for (var i = 0; i < groups.length; i++) {
      var alternatives = Array.isArray(groups[i]) ? groups[i] : [groups[i]], found = false;
      for (var a = 0; a < alternatives.length && !found; a++) {
        var synonyms = SYN[alternatives[a]] || [alternatives[a]];
        for (var j = 0; j < synonyms.length; j++) {
          var term = normalize(synonyms[j]);
          if (term && (' ' + n + ' ').indexOf(' ' + term + ' ') >= 0) { found = true; break; }
        }
      }
      if (!found) return false;
    }
    return true;
  }
  function knowledgeAnswer(n) {
    for (var i = 0; i < K.length; i++) {
      var item = K[i], alias = false;
      for (var j = 0; j < (item.aliases || []).length; j++) {
        if ((' ' + n + ' ').indexOf(' ' + normalize(item.aliases[j]) + ' ') >= 0) { alias = true; break; }
      }
      if (alias || groupsMatch(n, item.groups)) return item.answer;
    }
    return null;
  }
  function numberAnswer(n) {
    var m = /^(?:(?:what is|how much is|calculate|compute|solve) )?(-?\d+(?:\.\d+)?)\s*(plus|\+|minus|−|-|times|multiplied by|x|\*|divided by|over|÷|\/)\s*(-?\d+(?:\.\d+)?)$/.exec(n);
    if (m) {
      var a = Number(m[1]), b = Number(m[3]), op = m[2], result;
      if (op === 'plus' || op === '+') result = a + b;
      else if (op === 'minus' || op === '−' || op === '-') result = a - b;
      else if (op === 'times' || op === 'multiplied by' || op === 'x' || op === '*') result = a * b;
      else if (op === 'divided by' || op === 'over' || op === '÷' || op === '/') { if (!b) return "Division by zero is undefined."; result = a / b; }
      if (!isFinite(result)) return null;
      return String(Math.round(result * 1000000) / 1000000) + '.';
    }
    m = /^(?:(?:convert|what is) )?(-?\d+(?:\.\d+)?)\s*(km|kilometres?|kilometers?)\s+(?:to|in)\s+(miles?|mi)$/.exec(n);
    if (m) return (Number(m[1]) * 0.621371).toFixed(2).replace(/\.00$/, '') + ' miles.';
    m = /^(?:(?:convert|what is) )?(-?\d+(?:\.\d+)?)\s*(miles?|mi)\s+(?:to|in)\s+(km|kilometres?|kilometers?)$/.exec(n);
    if (m) return (Number(m[1]) * 1.60934).toFixed(2).replace(/\.00$/, '') + ' kilometres.';
    m = /^(?:(?:convert|what is) )?(-?\d+(?:\.\d+)?)\s*(c|celsius|°c)\s+(?:to|in)\s+(f|fahrenheit|°f)$/.exec(n);
    if (m) return (Number(m[1]) * 9 / 5 + 32).toFixed(1).replace(/\.0$/, '') + ' degrees Fahrenheit.';
    m = /^(?:(?:convert|what is) )?(-?\d+(?:\.\d+)?)\s*(f|fahrenheit|°f)\s+(?:to|in)\s+(c|celsius|°c)$/.exec(n);
    if (m) return ((Number(m[1]) - 32) * 5 / 9).toFixed(1).replace(/\.0$/, '') + ' degrees Celsius.';
    m = /^(?:(?:convert|what is) )?(-?\d+(?:\.\d+)?)\s*(kg|kilograms?)\s+(?:to|in)\s+(lbs?|pounds?)$/.exec(n);
    if (m) return (Number(m[1]) * 2.20462).toFixed(2).replace(/\.00$/, '') + ' pounds.';
    m = /^(?:(?:convert|what is) )?(-?\d+(?:\.\d+)?)\s*(lbs?|pounds?)\s+(?:to|in)\s+(kg|kilograms?)$/.exec(n);
    if (m) return (Number(m[1]) / 2.20462).toFixed(2).replace(/\.00$/, '') + ' kilograms.';
    m = /^(?:(?:convert|what is) )?(-?\d+(?:\.\d+)?)\s*(l|litres?|liters?)\s+(?:to|in)\s+(us gallons?|gallons?|gal)$/.exec(n);
    if (m) return (Number(m[1]) / 3.78541).toFixed(2).replace(/\.00$/, '') + ' US gallons.';
    m = /^(?:(?:convert|what is) )?(-?\d+(?:\.\d+)?)\s*(us gallons?|gallons?|gal)\s+(?:to|in)\s+(l|litres?|liters?)$/.exec(n);
    if (m) return (Number(m[1]) * 3.78541).toFixed(2).replace(/\.00$/, '') + ' litres.';
    return null;
  }
  function classify(n) {
    if (/^(who are you|what are you|introduce yourself|what is your name)\b/.test(n)) return 'introduction';
    if (/^(what is new|anything new|just chatting|how is your day|how has your day been|how are things)\b/.test(n)) return 'casual';
    if (/\b(yeah right|nice going|brilliant idea|great plan|sure thing|obviously)\b/.test(n)) return 'sarcasm';
    if (/\b(sad|lonely|stressed|overwhelmed|worried|anxious|rough time|need to vent|feeling low)\b/.test(n)) return 'empathy';
    if (/\b(good morning|morning|good afternoon|good evening|evening)\b/.test(n)) return 'time';
    if (/^(hi|hello|hey|howdy|yo|sup|what is good|nice to meet you|good to see you)\b/.test(n)) return 'greeting';
    if (/\b(how are you|how is it going|how you doing|you good|you okay|how have you been)\b/.test(n)) return 'status';
    if (/\b(what is happening|what is going on|what is up|anything happening|what are you doing|what are you up to)\b/.test(n)) return 'happening';
    if (/\b(tell me a joke|joke|make me laugh|say something funny)\b/.test(n)) return 'joke';
    if (/\b(that is funny|you are funny|good one|nice one|well done)\b/.test(n)) return 'compliment';
    if (/\b(you are right|that is right|exactly|i agree|true enough|sounds good|makes sense)\b/.test(n)) return 'agree';
    if (/\b(i disagree|that is wrong|i do not think so|not really|no way)\b/.test(n)) return 'disagree';
    if (/\b(i can do this|i need encouragement|motivate me|i feel down|i cannot do this)\b/.test(n)) return 'encourage';
    if (/\b(frustrated|annoying|this sucks|bad day|rough day|i am fed up)\b/.test(n)) return 'frustrated';
    if (/\b(goodbye|bye|see you|talk later|good night|goodnight)\b/.test(n)) return 'goodbye';
    if (/\b(and you|what about you|how about you|tell me more|go on)\b/.test(n)) return 'followup';
    if (/\b(say something|anything to say|make an observation|surprise me)\b/.test(n)) return 'observation';
    return null;
  }
  function getDestination(history) {
    if (!Array.isArray(history)) return '';
    for (var i = history.length - 1; i >= 0; i--) {
      var turn = history[i], text = turn && turn.role === 'user' && turn.parts && turn.parts[0] && turn.parts[0].text;
      if (!text) continue;
      var n = normalize(text), m = /\b(?:i am|i'm|we are|we're|heading|driving|traveling|travelling)\s+(?:going\s+)?(?:to|for)\s+([a-z][a-z .'-]{1,50})/.exec(n);
      if (m) return m[1].replace(/\b(?:tomorrow|today|next week|soon|for vacation|for work)\b.*$/, '').trim().replace(/[. ]+$/, '');
    }
    return '';
  }
  function vehicleModel(memories) {
    if (!Array.isArray(memories)) return '';
    for (var i = memories.length - 1; i >= 0; i--) {
      var x = memories[i] || {}, info = x.value || '';
      if (!info && x.category === 'vehicle') info = x.text || '';
      if (!info) {
        var m = /\b(?:truck|vehicle|car|pickup)\s+is\s+(?:a|an|the)?\s*([a-z0-9 -]{3,60})/i.exec(x.text || '');
        if (m) info = m[1].replace(/[.!?].*$/, '').trim();
      }
      if (info) return info;
    }
    return '';
  }
  var PLACE_GUIDE = {
    kelowna:"Kelowna sits beside Okanagan Lake; the waterfront, outdoor trails, and nearby wineries are common visitor options."
  };
  function contextualReply(text, ego, options) {
    var n = normalize(text), destination = getDestination(options && options.history);
    if (/\b(what should i do|what can i do|what is there to do|things to do)\s+(?:over )?there\b/.test(n) && destination) {
      var suggestion = PLACE_GUIDE[destination] || "I don't have a checked local guide for that place yet; tell me what kind of activity you enjoy and I can narrow it down.";
      return fill(choose(ego, 'there', D[ego].there), {place:destination, suggestion:suggestion});
    }
    if (/\b(engine|motor|horsepower)\b/.test(n) && (/\bit\b/.test(n) || /\b(truck|vehicle|car|pickup)\b/.test(n))) {
      var model = vehicleModel(options && options.memories);
      if (model) return fill(choose(ego, 'vehicleFollowup', D[ego].vehicleFollowup), {place:model, suggestion:'', time:''});
    }
    var travel = /\b(?:i am|i'm|we are|we're|heading|driving|traveling|travelling)\s+(?:going\s+)?(?:to|for)\s+([a-z][a-z .'-]{1,50})/.exec(n);
    if (travel) {
      var place = travel[1].replace(/\b(?:tomorrow|today|next week|soon|for vacation|for work)\b.*$/, '').trim().replace(/[. ]+$/, '');
      if (place.length > 1) return fill(choose(ego, 'trip', D[ego].trip), {place:place});
    }
    return null;
  }
  function reply(text, ego, options) {
    ego = D[ego] ? ego : 'nexus'; options = options || {};
    var n = normalize(text);
    if (!n) return null;
    var repeated = lastQuestion[ego] === n;
    lastQuestion[ego] = n;
    var conversational = classify(n);
    if (conversational) {
      if (repeated && conversational !== 'time') conversational = 'repeat';
      var lines = D[ego][conversational] || D.nexus[conversational];
      if (conversational === 'time') {
        var hour = options.hour;
        var period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
        return fill(choose(ego, conversational, lines), {time:period});
      }
      return choose(ego, conversational, lines);
    }
    if (questionIntent(n)) {
      var number = numberAnswer(n), factAnswer = number || knowledgeAnswer(n);
      if (repeated && factAnswer) return choose(ego, 'repeat', D[ego].repeat) + ' ' + factAnswer;
      return factAnswer;
    }
    if (repeated) return choose(ego, 'repeat', D[ego].repeat);
    return null;
  }
  root.NEXUS_LOCAL_CONVERSATION = {
    respond: reply,
    contextualReply: contextualReply,
    clarify: function (ego) { ego = D[ego] ? ego : 'nexus'; return choose(ego, 'clarify', D[ego].clarify); },
    knowledgeAnswer: function (text) {
      var n = normalize(text), number = numberAnswer(n);
      return number || knowledgeAnswer(n);
    },
    dialogue: D,
    knowledge: K
  };
})(window);
