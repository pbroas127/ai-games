/* BAIT — CHAPTER 3: LINKAGE.
 *
 * AUTHOR: Quarry. Arc, briefs and design contract are Atlas's, in
 * src/data/chapters.js. This file only executes them.
 *
 * Gates, plates (hold versus latch), teleports. Routing puzzles where the
 * shortest line is not the legal one.
 *
 * ---------------------------------------------------------------------------
 * THREE MECHANICAL FACTS I HAD TO AUTHOR AROUND, read from Forge's sim.js.
 * They are not in the briefs and they change what a room can ask for.
 *
 * 1. A HOLD PLATE'S GATE IS NEVER A DOOR. hold[] is set from the CENTRE CELL
 *    only (updatePlates), so the instant your centre leaves the plate the gate
 *    turns solid at the end of that tick, and step() opens the next tick with
 *    insideSolid() -> 'crushed'. Walking plate -> gate is death, always, with
 *    no exception at any speed. So hold plates in this chapter switch things
 *    at a distance (bullets, 3-09) or they are traps (3-03). They never open a
 *    way through for the player. Latch does that.
 *
 * 2. A LATCH PLATE ORTHOGONALLY ADJACENT TO ITS OWN GATE IS A CRUSH TRAP.
 *    Stepping from the gate cell onto the plate leaves your square (half
 *    extent 7 in a 40px cell) still overlapping the gate when the toggle
 *    fires. Every latch plate in this file is at least two cells from every
 *    gate on its link, except where the crush IS the room (3-03).
 *
 * 3. TOGGLE IS ON ENTRY, so a dead-end spur containing a plate is always an
 *    EVEN number of crossings. Any room whose answer is "cross it once" needs
 *    a loop or a bypass, which is what 3-11 is built out of.
 *
 * par is null. Sieve's solver computes it. Nothing here is hand tuned.
 */
(function (BAIT) {
  'use strict';

  var R = BAIT.Chapters.R;

  BAIT.Chapters.addRooms(3, [

    /* Nothing can kill you here and that is the point. One plate, one gate,
     * one number on both. The gate is in the middle of the only wall, so the
     * mechanic is the whole room and there is nowhere to look but at it. */
    R('3-01', 'FIRST LINK',
      'A latch plate toggles its gate, and the gate stays that way.',
      'None. A clean statement of the mechanic before it is used against you.',
      ['####################',
       '#o.......#.........#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#S.......G........E#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#...._...#.........#',
       '#........#.........#',
       '#........#.........#',
       '####################'],
      { '9,6': { link: 1 }, '5,10': { link: 1, mode: 1 } }),

    /* Link NUMBERS, not proximity. The plate you can reach is 1 and it opens
     * the far gate; the plate that opens the near gate is 2 and it is locked
     * behind gate 1. Read the numbers and the order is forced and obvious.
     * Read the layout and you walk to the wrong gate first.
     *
     * NOTE FOR ATLAS: the brief's twist is "opening one gate closes your route
     * back to the other plate". I could not build that honestly. Latch gates
     * start shut and a plate only ever toggles, so the only thing that closes
     * a route is re-crossing a plate, and any trip into a dead end crosses it
     * twice and cancels itself (fact 3 above). Realised as a forced-order
     * puzzle instead. Argue it and I will rebuild. */
    R('3-02', 'CROSSED WIRES',
      'Gates and plates are paired by their number and by nothing else.',
      'The near gate is opened by the far plate, which is behind the far gate.',
      ['####################',
       '#......#.....#o....#',
       '#......#.._..#.....#',
       '#......G.....#.....#',
       '#......#.....#.....#',
       '#......#.....#.....#',
       '#S.....#.....#....E#',
       '#......#.....#.....#',
       '#......#.....#.....#',
       '#......#.....#.....#',
       '#......#.....G.....#',
       '#.._...#.....#.....#',
       '#......#.....#.....#',
       '####################'],
      { '7,3': { link: 1 }, '13,10': { link: 2 },
        '3,11': { link: 1, mode: 1 }, '10,2': { link: 2, mode: 1 } }),

    /* The two plates are one cell of margin apart in meaning and a whole room
     * apart in behaviour, and Ink draws the difference: one bar is hold, two
     * bars is latch. The hold plate sits directly against its gate, which is
     * the shortest line to the exit and is fatal, because the gate shuts on
     * you the moment your centre leaves the plate. The latch plate is on the
     * far side of the room and its gate is the honest door.
     *
     * Nothing is hidden. Both plates are visible from the start, both gates
     * are in the same wall, and the death is 'crushed' with the gate drawn
     * shut on top of you. You are told which is which and you are told what
     * the words mean. This is the room that makes 3-09 fair. */
    R('3-03', 'ONE BAR, TWO BARS',
      'A hold plate only holds while you stand on it, so its gate is not a door.',
      'The short way is one cell from the plate that opens it, and it kills you.',
      ['####################',
       '#............#....o#',
       '#............#.....#',
       '#....#####...#.....#',
       '#........#...#.....#',
       '#........#...#.....#',
       '#S.......#.._G.....#',
       '#........#...#.....#',
       '#........#...#.....#',
       '#....#####...#.....#',
       '#............#.....#',
       '#..._........G.....#',
       '#............#....E#',
       '####################'],
      { '13,6': { link: 1 }, '12,6': { link: 1, mode: 0 },
        '13,11': { link: 2 }, '4,11': { link: 2, mode: 1 } }),

    /* You do not choose where you land. You choose what you are DOING when you
     * land, because heading survives the trip. Walk east into the pad and you
     * come out running east at a pit. Come at the pad from below and you come
     * out running north, which is the way the room wants you to go. The whole
     * lesson is that the teleport is not a door, it is a launch.
     *
     * The token is in a one-cell alcove with pit on three sides at the end of
     * a pit-flanked run. It is the first token in the chapter that costs
     * precision rather than distance. */
    R('3-04', 'HEADING INTACT',
      'You leave the twin pad moving exactly the way you entered its partner.',
      'The obvious approach launches you east, and east is a pit.',
      ['####################',
       '#.........#........#',
       '#...####..#........#',
       '#......#..#........#',
       '#......#..#...xxxx.#',
       '#......#..#.W.xxo..#',
       '#......#..#...xxxx.#',
       '#......#..#........#',
       '#...####..#........#',
       '#.........#........#',
       '#S.....W..#........#',
       '#.........#........#',
       '#.........#.......E#',
       '####################'],
      { '7,10': { link: 1 }, '12,5': { link: 1 } }),

    /* Four pads, two pairs, and the pairing is diagonal. The two that share a
     * row look like partners and are not. Take the top-left one and you are
     * dropped in the bottom-right half, under the divider, with the exit above
     * you and the token beside you. It costs a lap through the gap at (12,7),
     * never a clear, and the number is printed on every pad. */
    R('3-05', 'FALSE PAIRS',
      'Reading a link number at a glance, before you commit to the pad.',
      'The pads that look paired are not. The pairs run diagonally.',
      ['####################',
       '#..........#.......#',
       '#..........#......E#',
       '#...W......#..W....#',
       '#..........#.......#',
       '#..........#.......#',
       '#.....S....#.......#',
       '#..........#.#######',
       '#..........#.......#',
       '#..........#.......#',
       '#...W......#..W....#',
       '#..........#.......#',
       '#..........#......o#',
       '####################'],
      { '4,3': { link: 1 }, '14,10': { link: 1 },
        '4,10': { link: 2 }, '14,3': { link: 2 } }),

    /* Two plates, one link. The far one is the only way into the spine and it
     * shuts the door you came through. The exit is at the bottom of the inner
     * chamber and the token is at the top-left of the room, so committing
     * first and remembering the token second is a full walk back out through a
     * door you have to re-open, and then back in again. Nothing is lost, only
     * time, which is exactly the price commitment should have. */
    R('3-06', 'ONE WAY IN',
      'A second plate on the same link is a door closing, not a second door.',
      'The plate that lets you in is the plate that shuts the way out.',
      ['####################',
       '#o........#.#......#',
       '#.........#.#......#',
       '#.........#.#......#',
       '#.........G._......#',
       '#.........#.#......#',
       '#S........#.#......#',
       '#.........#.#......#',
       '#.........#.#......#',
       '#.........#.#......#',
       '#.........#.#......#',
       '#..._.....#.#......#',
       '#.........#.#.....E#',
       '####################'],
      { '10,4': { link: 1 }, '12,4': { link: 1, mode: 1 },
        '4,11': { link: 1, mode: 1 } }),

    /* The whole room is one loop with a plate on each side of it and the way
     * in to the middle at the top. Both plates are needed and they are as far
     * apart as the room can put them, so the answer is a lap and a half: down
     * one side, along the far edge, back up the other, then in. There is no
     * shortcut and there is not meant to be one. The order does not matter,
     * which is the point of putting them symmetrically: the room is about how
     * many times you go round, not which way.
     *
     * The token spur hangs off the bottom edge on the side you would otherwise
     * clip, so it is six cells down and six back on a route that is already
     * the longest walk in the chapter. */
    R('3-07', 'TWO LAPS',
      'Order of operations, when the operations are at opposite ends of a loop.',
      'One lap opens one gate. The tunnel needs both, so the loop is run twice.',
      ['####################',
       '#..................#',
       '#.#######G########.#',
       '#.#######.########.#',
       '#.#######G########.#',
       '#.#######.########.#',
       '#.#####.....######.#',
       '#_#####..E..######_#',
       '#.#####.....######.#',
       '#.##############o#.#',
       '#.##############.#.#',
       '#.##############.#.#',
       '#........S.........#',
       '####################'],
      { '9,2': { link: 1 }, '9,4': { link: 2 },
        '1,7': { link: 1, mode: 1 }, '18,7': { link: 2, mode: 1 } }),

    /* The pad drops you into a live lane, four cells from the muzzle, facing
     * the way out. The turret is slow and it never varies, so the arrival tick
     * is knowable before you commit: the only question is where the last
     * bullet is when you step on the pad. The block in the start room is there
     * so the answer to "not yet" is a lap round it, never a stand.
     *
     * The token is two cells DEEPER into the lane, toward the gun. Going for
     * it doubles the time you spend in front of the muzzle and it is the only
     * thing in this room that can kill you twice in one run. */
    R('3-08', 'THE COUNT',
      'Know where the pad puts you, and know what is already in flight there.',
      'You land in the lane. The cadence you have to count started before you.',
      ['####################',
       '#.......#.........E#',
       '#.......#..........#',
       '#.......#..........#',
       '#..###..#....####..#',
       '#..###..#....####..#',
       '#..###..#....####..#',
       '#.......#..........#',
       '#...W...#..........#',
       '#.......#..........#',
       '#.......##.#########',
       '#.......#...W.o...T#',
       '#S......############',
       '####################'],
      { '4,8': { link: 1 }, '12,11': { link: 1 },
        '18,11': { dir: 7, period: 15, phase: 0 } }),

    /* The gate is the muzzle plug, which is the cleanest way to show that a
     * gate stops bullets: while it is shut the turret cannot fire at all, and
     * the shaft is a safe dead corridor with a token sitting in it.
     *
     * The three hold plates are the only way across the room and crossing them
     * opens the plug for about sixty ticks, so you let a shot or two down the
     * shaft and then the plug closes behind you forever, and whatever you
     * released is still falling when you reach the crossing two cells later.
     * The exit is in the far corner and not on the crossing row, so the run
     * cannot be one held direction: you cross, then you turn. Going NORTH for
     * the token walks straight back up into what you just let go. Standing on
     * the plates is the one thing that is never safe, so the room can never be
     * solved by standing still. */
    R('3-09', 'SHUTTER',
      'A shut gate absorbs bullets, and a gate on the muzzle stops the shot.',
      'The only way across the room is the switch that opens fire.',
      ['####################',
       '##########T#########',
       '##########G#########',
       '##########.#########',
       '##########.#########',
       '##########o#########',
       '##########.#########',
       '#........#........E#',
       '#........#.........#',
       '#S....___..........#',
       '#........#.#########',
       '#........#.#########',
       '##########.#########',
       '####################'],
      { '10,1': { dir: 5, period: 12, phase: 0 },
        '10,2': { link: 1 },
        '6,9': { link: 1, mode: 0 },
        '7,9': { link: 1, mode: 0 },
        '8,9': { link: 1, mode: 0 } }),

    /* Four sealed chambers and no walking route between any of them, so the
     * only thing in the room is the order you take the pads in. Every pad
     * carries its number, and 3-05 already taught you to read it before you
     * step, so the whole room is legible from the start screen: 1 takes you
     * out of the start box, 2 crosses to the bottom half, 3 lets you into the
     * exit pocket. Nothing here can kill you. The only currency is time.
     *
     * Pair 4 is the lie. Its two pads are in the SAME chamber, one sitting on
     * the natural diagonal out of the pad you arrived on and one two cells
     * back above that pad, so taking it undoes the traversal you just paid for
     * and drops you where you began. It is the only pair whose twin you cannot
     * see from the pad, because its twin is behind you.
     *
     * The token hangs in a three-cell spur behind the wall stub at column 9,
     * off the far end of the same chamber. It is a dead end, so it cannot be
     * folded into the route: eight cells down and back, on the one leg of the
     * trip you cannot shorten. */
    R('3-10', 'FOUR PAIRS',
      'Route the whole trip before you touch the first pad. Four pairs, one order.',
      'One pair loops back into its own chamber and costs you the leg you just ran.',
      ['####################',
       '#.....#............#',
       '#.W...#..........W.#',
       '#.....#............#',
       '#.....#.W..........#',
       '#.....#............#',
       '#.....##############',
       '#.....#............#',
       '#S....#.W..........#',
       '#######..........W.#',
       '#.W...#..#.....W...#',
       '#.....#..#.......W.#',
       '#.E...#.o#.........#',
       '####################'],
      { '2,2': { link: 1 }, '17,2': { link: 1 },
        '8,4': { link: 2 }, '17,11': { link: 2 },
        '8,8': { link: 3 }, '2,10': { link: 3 },
        '15,10': { link: 4 }, '17,9': { link: 4 } }),

    /* A latch is not a switch you throw, it is a count of how many times you
     * have stood on it, and only the parity of that count survives. The room
     * is one ring: a corridor along the top, a corridor along the bottom, and
     * a connector down each side. The plate sits in the middle of the top
     * corridor, which is one cell wide, so it cannot be walked around. The key
     * is at the far end of that same corridor and the exit shaft hangs off the
     * bottom, nine cells below the plate, well clear of any crush.
     *
     * So the key trip is compulsory and it crosses the plate. Walk out the way
     * you walked in and that is two crossings, the gate is shut again, and you
     * arrive at the shaft having done everything right and changed nothing.
     * The ring is the answer: in over the plate, on round the far side, down
     * to the shaft, one crossing. The short way back is the trap and the whole
     * room is drawn on screen at once, so it is a decision and not a surprise.
     *
     * The token is in a three-cell dead-end spur off the left connector, on
     * the first leg, before the plate. Six cells of pure tax and it can never
     * interact with the gate. */
    R('3-11', 'PARITY',
      'A latch counts. Only odd and even matter, not which way you meant it.',
      'The key is past the plate, and walking back out re-shuts the door you opened.',
      ['####################',
       '#........_.......k.#',
       '#.################.#',
       '#.################.#',
       '#.################.#',
       '#.#####......#####.#',
       '#...o##..E...#####.#',
       '#.#####......#####.#',
       '#.#####......#####.#',
       '#.#######.########.#',
       '#.#######G########.#',
       '#.#######.########.#',
       '#.S................#',
       '####################'],
      { '9,1': { link: 1, mode: 1 }, '9,10': { link: 1 } }),

    /* A moat of pit with one cell of floor across it, and that cell is a
     * faller, so the crossing exists exactly once. Everything the plate side
     * of the room needs from the start side has to be carried over on that one
     * trip, and the only thing on the start side worth carrying is the token,
     * sitting in the far corner behind the block. Cross first and the token is
     * gone for the run. Nothing is lost that you cannot see going.
     *
     * NOTE FOR ATLAS: the brief's twist is "you get exactly one trip to set the
     * room's state correctly", and I could not make the PLATE the one trip. A
     * latch toggles on ENTRY, so stepping off a plate and back on flips it
     * again; no arrangement of plates can be one-shot, and any room built as if
     * it were would just be a walk back and forth. So the one trip is the
     * faller and the state is what you are holding when you take it. The gate
     * past the moat is an ordinary latch on a through corridor, deliberately
     * plain, because the commitment is the idea and it only needs one.
     *
     * The plate is nine cells below its gate, so there is no crush here. */
    R('3-12', 'ONE TRIP',
      'The bridge is a faller. There is one crossing and you choose when to spend it.',
      'Everything you want from this side has to be picked up before you step on it.',
      ['####################',
       '#o.......x....#....#',
       '#........x....#..E.#',
       '#..####..x....G....#',
       '#..####..x....#....#',
       '#..####..x....######',
       '#..####..f.........#',
       '#..####..x.........#',
       '#..####..x.#######.#',
       '#..####..x.#######.#',
       '#........x.#######.#',
       '#........x.#######.#',
       '#S.......x...._....#',
       '####################'],
      { '14,12': { link: 1, mode: 1 }, '14,3': { link: 1 } }),

    /* CHAPTER END. Three links in series and the room folded into three lanes,
     * so the legal line is the whole room twice over: plate 1 opens the gate in
     * the bottom lane, plate 2 is up a spur in the middle lane and opens the
     * gate in it, plate 3 is up a spur in the top lane and opens the last gate.
     * Every plate sits at the dead end of its spur, entered once, so nothing
     * here can be undone by walking back out. After twelve rooms of this the
     * chain is readable at a glance and that is the point: you can see the
     * whole legal route from the start, and you can see how long it is.
     *
     * The pad is four cells from the start and it is a one-cell stub off the
     * bottom lane, so the only way in is northward and the only way out of the
     * twin is northward too, straight at the pits beside the exit. It is not a
     * gamble, it is a commitment: two cells and about a quarter second to turn
     * east, on the one piece this chapter has spent every room telling you not
     * to trust. That is the whole finale. Take the long way and you are safe
     * and slow. Take the pad and you are at the exit in a sixth of the walk.
     *
     * DELIBERATE TOKEN/SWIFT CONFLICT. The token is up a spur in the middle
     * lane, which the pad skips entirely, so Swift and the token cannot both be
     * had in one pass. Clear is never in conflict: the twin is a live pad, so a
     * player who takes the shortcut can ride it back and walk the legal route
     * for the token afterwards. It costs time, which is the only thing this
     * room charges. */
    R('3-13', 'THE LONG WAY',
      'Three links in series. The room is a chain and you walk all of it.',
      'The pad cuts six sevenths of that off and points you at a pit doing it.',
      ['####################',
       '###############xxxE#',
       '####_##########....#',
       '####.####.......W..#',
       '#.......G..........#',
       '#.##################',
       '#.#o##########_#####',
       '#.#.##########.#####',
       '#........G.........#',
       '##################.#',
       '#####_############.#',
       '#####.#W##########.#',
       '#S........G........#',
       '####################'],
      { '5,10': { link: 1, mode: 1 }, '10,12': { link: 1 },
        '14,6': { link: 2, mode: 1 }, '9,8': { link: 2 },
        '4,2': { link: 3, mode: 1 }, '8,4': { link: 3 },
        '7,11': { link: 4 }, '16,3': { link: 4 } })

  ]);

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
