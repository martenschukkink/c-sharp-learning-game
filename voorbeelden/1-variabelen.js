// Code Gangen – voorbeeldlevel: variabelen
window.LEVEL = {
  titel: 'Variabelen declareren en wijzigen',
  code: `
int leeftijd = 16;
leeftijd = leeftijd + 1;
string naam = "Sam";
Console.WriteLine(naam + " is " + leeftijd);
double prijs = 2.5;
prijs = prijs * 2;
Console.WriteLine(prijs);
`,
  uitleg: {
    2: 'Sam is jarig! Kijk in je inventory hoe de oude waarde verdwijnt.',
  },
};
