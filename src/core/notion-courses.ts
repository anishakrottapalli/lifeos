// One-time move of the Courses page from Notion into LifeOS (copied from the page on 2026-11-19).
// Everything is imported as Completed (the owner asked for that). The original sections were Completed, Up Next and Ongoing.

export interface NotionCourse {
  title: string;
  provider?: string;
  instructor?: string;
  /** Where it was in Notion. Everything is saved as Completed when imported. */
  status: "Want" | "In progress" | "Done";
  parts?: string[];
  /** Lessons inside one of the parts, by that part's title. */
  lessons?: Record<string, string[]>;
  /** Loose files already in the program's folder (put there in Finder) and where they belong: "Course" or "Course/Lesson". */
  place?: Record<string, string[]>;
}

/** A part is written "Course name | Instructor" (the instructor is optional). */
export function splitPart(part: string): { title: string; instructor: string } {
  const [title, ...rest] = part.split("|");
  return { title: title.trim(), instructor: rest.join("|").trim() };
}

export const NOTION_COURSES: NotionCourse[] = [
  { title: "CAPM Exam Prep Seminar - PMBOK Guide, Sixth Edition", instructor: "Joseph Phillips", provider: "Udemy", status: "Done" },
  { title: "Build Your Life Resume", instructor: "Jesse Itzler", status: "Done" },
  { title: "The Science of Well-Being", instructor: "Laurie Santos", provider: "Coursera", status: "Done" },
  {
    title: "IBM Data Science Professional Certificate",
    provider: "Coursera",
    instructor: "IBM",
    status: "Done",
    parts: [
      "What is Data Science?",
      "Tools for Data Science",
      "Data Science Methodology",
      "Python for Data Science, Al & Development",
      "Python Project for Data Science",
      "Databases and SQL for Data Science with Python",
      "Data Analysis with Python",
      "Data Visualization with Python",
      "Machine Learning with Python",
      "Applied Data Science Capstone",
    ],
  },
  { title: "Ethical Leadership Certification", provider: "NASBA Center for Public Trust", status: "Done" },
  { title: "User Experience Design Essentials - Adobe XD UI UX Design", instructor: "Daniel Scott", provider: "Udemy", status: "Done" },
  {
    title: "UX Certificate",
    provider: "CareerFoundry",
    status: "Done",
    parts: ["Intro to UX Design", "UX Immersion", "Front-End Development"],
    lessons: {
      "UX Immersion": [
        "1 - Thinking Like a User",
        "2 - Understanding the User",
        "3 - Foundational Design",
        "4 - Usability Testing",
        "5 - Refining the Design",
        "6 - End to End Design",
      ],
      "Front-End Development": ["1 - Getting Started with HTML & CSS", "2 - JavaScript & Your Portfolio Site"],
    },
    place: {
      "Intro to UX Design": [
        "1.1- Introduction to UX & Design Thinking.pdf",
        "1.2- User Research.pdf",
        "1.3- User Personas.pdf",
        "1.4- Information Architecture.pdf",
        "1.5- Wireframing & Prototyping.pdf",
        "1.6- Usability Testing.pdf",
        "1.7- Presenting Your Work.pdf",
      ],
      "Front-End Development/1 - Getting Started with HTML & CSS": [
        "1.1-Getting Started with Your Frontend Course.pdf",
        "1.2 - Internet & the Web.pdf",
        "1.3 - Starting with HTML.pdf",
        "1.4 - Coding with HTML.pdf",
        "1.5 - Using GitHub for Your Projects.pdf",
        "1.6 - CSS Basics.pdf",
        "1.7 - CSS Layouts.pdf",
        "1.8 - Advanced CSS for Designers.pdf",
      ],
      "Front-End Development/2 - JavaScript & Your Portfolio Site": [
        "2.1 - Introduction to JavaScript.pdf",
        "2.2 - Coding with JavaScript.pdf",
        "2.3 - JavaScript Libraries & Plugins.pdf",
        "2.4 - User Testing.pdf",
        "2.5 - Code Quality & Cross-Browser Testing.pdf",
        "2.6 - Portfolio Site Demo & Case Study.pdf",
      ],
    },
  },
  { title: "Learning JIRA software", instructor: "Robert Anthony", provider: "LinkedIn Learning", status: "Done" },
  { title: "Speaking Up At Work", instructor: "Jessica Chen", provider: "LinkedIn Learning", status: "Done" },
  { title: "Finding Your Idea Hook", instructor: "Stefan Mumaw", provider: "LinkedIn Learning", status: "Done" },
  {
    title: "Become a Product Manager",
    provider: "LinkedIn Learning",
    status: "Done",
    parts: [
      "Product Management First Steps | Doug Winne",
      "Becoming a Product Manager | Cole Mercer and Evan Kimbrell",
      "Product Management: Product Strategy | Eldad Persky and Teg Grenager",
      "Product Management: Product Roadmap | Eldad Persky and Teg Grenager",
      "Product Management: Customer Development | Jay Clouse",
      "Product Innovation for Product Managers | Karen Holst",
      "Product Management: Launching Your Product | Karen Holst",
      "Technology for Product Managers | Cole Mercer",
    ],
  },
  { title: "Get Hired as a Product Manager - Applying & Interviewing", instructor: "Cole Mercer", provider: "Udemy", status: "Done" },
  { title: "Introduction to NFTs: Non-fungible Tokens", instructor: "Jonathan Reichental", provider: "LinkedIn Learning", status: "Done" },
  { title: "Pre-Programming: Everything you need to know before you code", instructor: "Evan Kimbrell", provider: "Udemy", status: "Done" },
  { title: "The Basics of Scrum", provider: "Project Management Institute", status: "Done" },
  { title: "Generative AI Overview for Project Managers", provider: "Project Management Institute", status: "Done" },
  { title: "Adobe Illustrator CC - Essentials Training", instructor: "Daniel Scott", provider: "Bring Your Own Laptop", status: "Done" },
  { title: "Adobe Lightroom CC - Essentials Training", instructor: "Daniel Scott", provider: "Bring Your Own Laptop", status: "Done" },
  { title: "Adobe Photoshop CC - Essentials Training", instructor: "Daniel Scott", provider: "Bring Your Own Laptop", status: "Done" },
  {
    title: "Adobe After Effects",
    instructor: "Daniel Scott",
    provider: "Bring Your Own Laptop",
    status: "Want",
    parts: [
      "After Effects - Learn Motion Graphic Design",
      "After Effects - Animated Infographic Video & Data Visualisation",
      "Using After Effects CC 2018, Excel and JSON to create graphs",
    ],
  },
  { title: "Adobe Premiere Pro Essentials", status: "Want" },
  { title: "Figma UI UX Design Essentials", status: "Want" },
  { title: "Investing Courses - Swing Trading / Technical Analysis", status: "In progress" },
];
